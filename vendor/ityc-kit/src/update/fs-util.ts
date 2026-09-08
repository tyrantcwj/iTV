import { createWriteStream } from "node:fs";
import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";
import { ghHeaders } from "./github.js";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 移动路径。跨设备时 rename 会失败（容器里 /tmp 与 /app 常常不同挂载点），
 * 回退到「复制 + 删源」。
 */
export async function movePath(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true }).catch(() => {});
  try {
    await rename(from, to);
  } catch {
    await cp(from, to, { recursive: true, force: true });
    await rm(from, { recursive: true, force: true });
  }
}

export async function moveIfExists(from: string, to: string): Promise<boolean> {
  if (!(await pathExists(from))) return false;
  await movePath(from, to);
  return true;
}

export async function downloadFile(url: string, dest: string, token?: string): Promise<void> {
  const res = await fetch(url, { headers: ghHeaders(token), redirect: "follow", signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}：${url}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
}
