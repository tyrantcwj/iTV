import { createInspector } from "ityc-kit/inspect";
import { applyUpdate, checkForUpdate, getUpdateRuntime } from "ityc-kit/update";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { channelStore, db, getSettings, mediaStore } from "./db.js";
import { hasFfmpeg } from "./lib/ffmpeg.js";

export const APP_VERSION = "0.1.0";
export const REPO = process.env.ITYC_REPO || "tyrantcwj/iTV";
export const COMMIT = process.env.BUILD_COMMIT || "dev";

function tokenFromReq(req: FastifyRequest) {
  const q = req.query as { token?: string };
  return q.token;
}

export function createAppInspector() {
  return createInspector({
    token: () => process.env.AGENT_TOKEN,
    version: APP_VERSION,
    commit: COMMIT,
    app: {},
    probes: [
      {
        key: "onedrive",
        description: "世纪互联授权状态",
        collect: () => {
          const s = getSettings();
          return {
            connected: Boolean(s.refresh_token),
            displayName: s.display_name || "",
            tokenExpiresAt: s.access_expires_at || 0,
          };
        },
      },
      {
        key: "library",
        description: "片库与频道",
        collect: () => {
          const media = mediaStore.list();
          return {
            media: media.length,
            missingDuration: media.filter((m) => !m.duration_sec).length,
            channels: channelStore.list().length,
            sqlite: { ok: Boolean(db.prepare("SELECT 1").get()) },
          };
        },
      },
      {
        key: "ffmpeg",
        description: "M3U 直播转封装",
        collect: async () => ({ available: await hasFfmpeg() }),
      },
    ],
    actions: [
      {
        name: "diagnose",
        description: "只读诊断，不改动任何状态",
        mutates: false,
        run: async () => {
          const runtime = await getUpdateRuntime({
            mode: (process.env.ITYC_UPDATE_MODE as "source" | "docker" | "disabled" | "auto") || "auto",
          });
          return {
            ok: true,
            commit: COMMIT,
            updateRuntime: runtime,
            ffmpeg: await hasFfmpeg(),
            onedrive: Boolean(getSettings().refresh_token),
          };
        },
      },
      {
        name: "update",
        description: "拉取最新代码或镜像并重启",
        run: async () =>
          applyUpdate({
            repo: REPO,
            appRoot: process.env.ITYC_APP_ROOT || "/app",
            branch: "main",
            githubToken: process.env.GITHUB_TOKEN,
            mode: (process.env.ITYC_UPDATE_MODE as "source" | "docker" | "auto") || "auto",
            containerName: process.env.ITYC_CONTAINER_NAME || "itv",
            runtimePaths: ["server", "vendor/ityc-kit"],
            buildSteps: [
              {
                label: "Installed ityc-kit",
                command: "npm",
                args: ["ci", "--prefix", "vendor/ityc-kit"],
                timeoutMs: 300_000,
              },
              {
                label: "Compiled ityc-kit",
                command: "npm",
                args: ["run", "build", "--prefix", "vendor/ityc-kit"],
                timeoutMs: 180_000,
              },
              {
                label: "Installed web",
                command: "npm",
                args: ["ci", "--prefix", "web"],
                timeoutMs: 300_000,
              },
              {
                label: "Built web",
                command: "npm",
                args: ["run", "build", "--prefix", "web"],
                timeoutMs: 300_000,
              },
              {
                label: "Installed server",
                command: "npm",
                args: ["ci", "--omit=dev", "--prefix", "server"],
                timeoutMs: 300_000,
              },
              {
                label: "Synced frontend",
                command: "sh",
                args: ["-c", "rm -rf server/public && cp -a web/dist server/public"],
                timeoutMs: 30_000,
              },
            ],
          }),
      },
    ],
  });
}

export async function registerAgentRoutes(app: FastifyInstance) {
  const inspector = createAppInspector();

  app.get("/api/version", async () => {
    const update = await checkForUpdate({ repo: REPO, currentCommit: COMMIT }).catch(() => null);
    const runtime = await getUpdateRuntime({
      mode: (process.env.ITYC_UPDATE_MODE as "source" | "docker" | "disabled" | "auto") || "auto",
    });
    return {
      name: "iTV",
      version: APP_VERSION,
      commit: COMMIT,
      repo: REPO,
      runtime,
      update,
    };
  });

  app.get("/api/agent/inspect", async (req, reply) => {
    const q = req.query as { token?: string; describe?: string };
    if (!(await inspector.authorize(req.headers.authorization, tokenFromReq(req)))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (q.describe) return inspector.describe();
    return inspector.snapshot(q as Record<string, string | undefined>);
  });

  app.post("/api/agent/act", async (req, reply) => {
    if (!(await inspector.authorize(req.headers.authorization, tokenFromReq(req)))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const body = (req.body ?? {}) as { action?: string; input?: unknown };
    if (!body.action) return reply.code(400).send({ error: "missing_action" });
    const r = await inspector.run(body.action, body.input, req.query as Record<string, string | undefined>);
    return r.ok ? r : reply.code(400).send(r);
  });
}
