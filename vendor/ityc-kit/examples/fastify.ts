/**
 * 把两个模块挂到 Fastify 上的最小例子。
 * Express/Koa 同理——这两个模块不依赖任何 Web 框架。
 */
import Fastify from "fastify";

import { createInspector } from "ityc-kit/inspect";
import { applyUpdate, checkForUpdate } from "ityc-kit/update";

const app = Fastify();

const REPO = "owner/repo";
const COMMIT = process.env.BUILD_COMMIT ?? "dev";

const inspector = createInspector({
  token: () => process.env.AGENT_TOKEN,
  version: "1.0.0",
  commit: COMMIT,
  app: { db: null },
  probes: [
    {
      key: "queue",
      description: "任务队列积压情况",
      collect: () => ({ pending: 0, running: 0 }),
    },
  ],
  actions: [
    {
      name: "diagnose",
      description: "只读诊断，不改动任何状态",
      mutates: false,
      run: () => ({ ok: true }),
    },
    {
      name: "update",
      description: "拉取最新源码并重启",
      run: () =>
        applyUpdate({
          repo: REPO,
          appRoot: "/app",
          githubToken: process.env.GITHUB_TOKEN,
          onProgress: (a) => app.log.info({ step: a }, "update"),
        }),
    },
  ],
});

/** 只读巡检快照 */
app.get("/api/agent/inspect", async (req, reply) => {
  const q = req.query as { token?: string };
  if (!(await inspector.authorize(req.headers.authorization, q.token))) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  if (q.describe) return inspector.describe();
  return inspector.snapshot(q as Record<string, string | undefined>);
});

/** 触发已注册的动作 */
app.post("/api/agent/act", async (req, reply) => {
  const q = req.query as { token?: string };
  if (!(await inspector.authorize(req.headers.authorization, q.token))) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const body = (req.body ?? {}) as { action?: string; input?: unknown };
  if (!body.action) return reply.code(400).send({ error: "missing_action" });
  const r = await inspector.run(body.action, body.input, q as Record<string, string | undefined>);
  return r.ok ? r : reply.code(400).send(r);
});

/** 版本与更新检查 */
app.get("/api/version", async () => ({
  commit: COMMIT,
  update: await checkForUpdate({ repo: REPO, currentCommit: COMMIT }).catch(() => null),
}));

await app.listen({ port: 3000, host: "0.0.0.0" });
