import type { HealthSnapshot } from "./types.js";

/**
 * 单次采样事件循环延迟。
 * setTimeout(0) 的实际耗时越大，说明事件循环越忙、或被同步代码阻塞。
 * 这是最便宜也最能说明问题的一个指标——卡顿时它会立刻涨上去。
 */
export async function measureEventLoopLagMs(): Promise<number> {
  const start = process.hrtime.bigint();
  await new Promise((r) => setTimeout(r, 0));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return Math.round(ms * 100) / 100;
}

export async function collectHealth(): Promise<HealthSnapshot> {
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
  return {
    process: {
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
    },
    memoryMB: {
      rss: mb(mem.rss),
      heapUsed: mb(mem.heapUsed),
      heapTotal: mb(mem.heapTotal),
      external: mb(mem.external),
    },
    eventLoopLagMs: await measureEventLoopLagMs(),
  };
}
