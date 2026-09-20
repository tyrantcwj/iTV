import { canAccessDockerSocket, runWatchtowerUpdate } from "./docker-update.js";
import { commitsDiffer, fetchLatestCommit, shortSha } from "./github.js";
import { runSourceUpdate } from "./source-update.js";
import type { UpdateOptions, UpdateResult, UpdateRuntime } from "./types.js";

export * from "./types.js";
export { commitsDiffer, fetchLatestCommit, shortSha } from "./github.js";
export { canAccessDockerSocket, dockerUpdatePreflight, runWatchtowerUpdate } from "./docker-update.js";

/**
 * 判断当前环境能用哪种更新方式。
 *
 * source：容器里拉源码、装依赖、构建、替换文件、退出让编排重启。
 *         不需要 Docker socket，权限要求最低，是默认选择。
 * docker：借一次性 Watchtower 拉新镜像重建容器。需要挂载 Docker socket。
 */
export async function getUpdateRuntime(options: Pick<UpdateOptions, "mode">): Promise<UpdateRuntime> {
  const forced = (options.mode ?? "auto") as string;
  if (forced === "disabled") {
    return { mode: "disabled", supported: false, detail: "在线更新已关闭。" };
  }
  if (forced === "source") {
    return { mode: "source", supported: true, detail: "拉取最新源码，在容器内构建并替换，随后重启进程。" };
  }
  if (forced === "docker") {
    const ok = await canAccessDockerSocket();
    return {
      mode: "docker",
      supported: ok,
      detail: ok
        ? "启动一次性 Watchtower，拉取最新镜像并重建当前容器。"
        : "未检测到可访问的 Docker socket，无法使用 docker 模式。",
    };
  }
  // auto：优先源码更新——它对权限要求最低，不必把 Docker socket 挂进容器
  return { mode: "source", supported: true, detail: "拉取最新源码，在容器内构建并替换，随后重启进程。" };
}

/** 当前版本是否落后于仓库最新提交 */
export async function checkForUpdate(options: {
  repo: string;
  currentCommit: string;
  branch?: string;
  githubToken?: string;
}): Promise<{ updateAvailable: boolean; current: string; latest: string; message: string; date?: string }> {
  const latest = await fetchLatestCommit(options.repo, options.branch ?? "main", options.githubToken);
  return {
    updateAvailable: commitsDiffer(options.currentCommit, latest.commit),
    current: shortSha(options.currentCommit),
    latest: shortSha(latest.commit),
    message: latest.message,
    date: latest.date,
  };
}

/**
 * 执行一次在线更新。
 *
 * source 模式在替换完成后会安排进程退出（默认 800ms 后），由编排把它拉起来。
 * 注意：这一步会切断当前 HTTP 连接，调用方多半收不到干净的响应，
 * 应当在几分钟后重新探测版本接口来确认结果，而不是等这个 Promise。
 */
export async function applyUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const runtime = await getUpdateRuntime(options);
  if (!runtime.supported) {
    return { ok: false, mode: runtime.mode, detail: runtime.detail, actions: [] };
  }

  if (runtime.mode === "docker") {
    const target = options.containerName || process.env.HOSTNAME;
    if (!target) {
      return { ok: false, mode: "docker", detail: "未指定要重建的容器名，且读不到 HOSTNAME。", actions: [] };
    }
    const run = await runWatchtowerUpdate(target);

    // 还在跑 = 它多半正忙着拉镜像、重建 target，而 target 就是我们自己。
    // 这条响应能不能发出去都两说，所以只说「已经在做了」，让调用方回头查版本。
    if (!run.finished) {
      return {
        ok: true,
        mode: "docker",
        detail: `Watchtower 正在重建容器 ${target}，连接可能短暂中断，稍后刷新版本确认。`,
        actions: [...run.actions, `Watchtower ${run.id.slice(0, 12)} 仍在执行`],
      };
    }

    if (run.exitCode !== 0) {
      return {
        ok: false,
        mode: "docker",
        detail: `Watchtower 以退出码 ${run.exitCode} 结束，更新没有发生。${run.logs || "（没有日志）"}`,
        actions: run.actions,
      };
    }

    // 退出码 0，而我们还活着——说明它一个容器都没换掉。真换了的话这段代码
    // 根本没机会运行：重建 target 的第一步就是把当前进程停掉。
    // 最常见的两种：镜像没有更新，或者容器名匹配不上。
    return {
      ok: false,
      mode: "docker",
      detail: `Watchtower 已结束但没有重建 ${target}：多半是镜像没有新版本，或容器名匹配不上。${run.logs || "（没有日志）"}`,
      actions: run.actions,
    };
  }

  const result = await runSourceUpdate(options);
  const delay = options.restartDelayMs ?? 800;
  if (delay > 0) {
    setTimeout(() => process.exit(0), delay).unref?.();
  }
  return {
    ok: true,
    mode: "source",
    commit: result.commit,
    detail: `源码已更新到 ${shortSha(result.commit)}，服务正在重启。`,
    actions: delay > 0 ? [...result.actions, "Scheduled process restart"] : result.actions,
  };
}
