import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { downloadFile, moveIfExists, movePath, pathExists } from "./fs-util.js";
import { archiveUrl, fetchLatestCommit, shortSha } from "./github.js";
import { DEFAULT_BUILD_STEPS, DEFAULT_RUNTIME_PATHS, type BuildStep, type UpdateOptions } from "./types.js";

const execFileAsync = promisify(execFile);

/** Windows 上 npm 是 npm.cmd，execFile 不走 shell，必须自己带后缀 */
function resolveBin(cmd: string): string {
  return process.platform === "win32" && !/\.(cmd|exe|bat)$/i.test(cmd) ? `${cmd}.cmd` : cmd;
}

/**
 * 把构建产物替换进 appRoot，替换前整体备份，任一步失败就回滚。
 *
 * 不回滚的话，一次失败的更新会让容器里同时存在新旧两套文件，
 * 服务重启后行为难以预测——宁可退回旧版本，也不要半新半旧。
 */
async function replaceRuntimeFiles(
  appRoot: string,
  sourceRoot: string,
  runtimePaths: string[],
): Promise<void> {
  const backupDir = join(appRoot, `.update-backup-${Date.now()}`);
  await mkdir(backupDir, { recursive: true });
  const backedUp: string[] = [];

  for (const name of runtimePaths) {
    if (await moveIfExists(join(appRoot, name), join(backupDir, name))) backedUp.push(name);
  }

  try {
    for (const name of runtimePaths) {
      const src = join(sourceRoot, name);
      if (!(await pathExists(src))) continue;
      await movePath(src, join(appRoot, name));
    }
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    // 回滚：把备份挪回原位，尽量让服务还能按旧版本跑起来
    for (const name of backedUp) {
      await movePath(join(backupDir, name), join(appRoot, name)).catch(() => {});
    }
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** 把版本信息写进源码目录，供应用在运行时读出来展示 */
async function writeBuildInfo(sourceRoot: string, info: { commit: string; message: string }): Promise<void> {
  const payload = {
    commit: info.commit,
    shortCommit: shortSha(info.commit),
    message: info.message,
    builtAt: new Date().toISOString(),
  };
  await writeFile(join(sourceRoot, "build-info.json"), JSON.stringify(payload, null, 2), "utf8").catch(() => {});
}

export async function runSourceUpdate(
  options: UpdateOptions,
): Promise<{ commit: string; actions: string[] }> {
  const branch = options.branch ?? "main";
  const steps: BuildStep[] = options.buildSteps ?? DEFAULT_BUILD_STEPS;
  const runtimePaths = options.runtimePaths ?? DEFAULT_RUNTIME_PATHS;
  const actions: string[] = [];
  const note = (a: string) => {
    actions.push(a);
    options.onProgress?.(a);
  };

  const latest = await fetchLatestCommit(options.repo, branch, options.githubToken);
  const workDir = await mkdtemp(join(tmpdir(), "ityc-kit-update-"));
  const archivePath = join(workDir, "source.tar.gz");
  const sourceDir = join(workDir, "source");

  try {
    await mkdir(sourceDir, { recursive: true });
    await downloadFile(archiveUrl(options.repo, branch, options.githubToken), archivePath, options.githubToken);
    note(`Downloaded source ${shortSha(latest.commit)}`);

    // GitHub 的 tarball 外面套一层带哈希的目录名，--strip-components=1 去掉它
    await execFileAsync("tar", ["-xzf", archivePath, "-C", sourceDir, "--strip-components=1"], { timeout: 120_000 });
    note("Extracted source archive");

    for (const step of steps) {
      await execFileAsync(resolveBin(step.command), step.args, {
        cwd: sourceDir,
        timeout: step.timeoutMs ?? 600_000,
      });
      note(step.label);
    }

    await writeBuildInfo(sourceDir, latest);
    await replaceRuntimeFiles(options.appRoot, sourceDir, runtimePaths);
    note(`Updated app files in ${options.appRoot}`);

    return { commit: latest.commit, actions };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
