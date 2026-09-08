import { timingSafeEqual } from "node:crypto";

import { collectHealth } from "./health.js";
import type {
  Action,
  ActionResult,
  InspectContext,
  InspectSnapshot,
  InspectorOptions,
  Probe,
} from "./types.js";

export * from "./types.js";
export { collectHealth, measureEventLoopLagMs } from "./health.js";

/** 常数时间比较，避免用比较耗时反推令牌 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type Inspector = {
  /** 采集一次完整快照 */
  snapshot: (query?: Record<string, string | undefined>) => Promise<InspectSnapshot>;
  /** 执行一个已注册的动作 */
  run: (name: string, input?: unknown, query?: Record<string, string | undefined>) => Promise<ActionResult>;
  /** 校验令牌：header 走 Bearer，或直接给 query 里的 token */
  authorize: (authorizationHeader?: string, queryToken?: string) => Promise<boolean>;
  /** 列出已注册的探针与动作，便于对接方自我发现 */
  describe: () => { probes: Array<{ key: string; description?: string }>; actions: Array<{ name: string; description?: string; mutates: boolean }> };
  addProbe: (probe: Probe) => void;
  addAction: (action: Action) => void;
};

export function createInspector(options: InspectorOptions): Inspector {
  const probes = new Map<string, Probe>();
  const actions = new Map<string, Action>();
  for (const p of options.probes ?? []) probes.set(p.key, p);
  for (const a of options.actions ?? []) actions.set(a.name, a);

  const expectedToken = (): string | undefined =>
    typeof options.token === "function" ? options.token()?.trim() : options.token?.trim();

  const ctxOf = (query?: Record<string, string | undefined>): InspectContext => ({
    query: query ?? {},
    app: options.app,
  });

  return {
    addProbe(probe) {
      probes.set(probe.key, probe);
    },
    addAction(action) {
      actions.set(action.name, action);
    },

    describe() {
      return {
        probes: [...probes.values()].map((p) => ({ key: p.key, description: p.description })),
        actions: [...actions.values()].map((a) => ({
          name: a.name,
          description: a.description,
          mutates: a.mutates !== false,
        })),
      };
    },

    async authorize(authorizationHeader, queryToken) {
      const bearer = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      const provided = bearer || queryToken?.trim();
      if (options.verifyToken) return await options.verifyToken(provided);
      const expected = expectedToken();
      // 没配令牌时一律拒绝：宁可用不了，也不能裸奔
      if (!expected || !provided) return false;
      return safeEqual(provided, expected);
    },

    async snapshot(query) {
      const ctx = ctxOf(query);
      const out: InspectSnapshot = {
        at: new Date().toISOString(),
        version: options.version,
        commit: options.commit,
        builtAt: options.builtAt,
        health: await collectHealth(),
      };
      const errors: Array<{ probe: string; error: string }> = [];
      // 探针之间互不影响：一个挂了不该让整份快照取不到
      for (const probe of probes.values()) {
        try {
          out[probe.key] = await probe.collect(ctx);
        } catch (err) {
          errors.push({ probe: probe.key, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (errors.length) out.probeErrors = errors;
      return out;
    },

    async run(name, input, query) {
      const startedAt = Date.now();
      const action = actions.get(name);
      if (!action) {
        return { ok: false, action: name, elapsedMs: 0, error: `未注册的动作：${name}` };
      }
      if (options.readOnly && action.mutates !== false) {
        return { ok: false, action: name, elapsedMs: 0, error: "只读模式下不允许执行会改动状态的动作" };
      }
      try {
        const parsed = action.parseInput ? action.parseInput(input) : input;
        const result = await action.run(parsed, ctxOf(query));
        return { ok: true, action: name, elapsedMs: Date.now() - startedAt, result };
      } catch (err) {
        return {
          ok: false,
          action: name,
          elapsedMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
