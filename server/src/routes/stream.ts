import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mediaStore } from "../db.js";
import { hasFfmpeg, spawnWebCompat } from "../lib/ffmpeg.js";
import { getDownloadUrl } from "../lib/onedrive.js";

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-disposition",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "x-download-options",
]);

async function fetchFollowingRedirects(url: string, headers: Record<string, string>, hops = 5) {
  let current = url;
  for (let i = 0; i < hops; i++) {
    const res = await fetch(current, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("下载地址重定向过多");
}

let currentCompat: ReturnType<typeof spawnWebCompat> | null = null;

function sendCompatStream(req: FastifyRequest, reply: FastifyReply, url: string, startSec: number) {
  if (currentCompat) {
    try {
      currentCompat.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    currentCompat = null;
  }

  const ff = spawnWebCompat(url, startSec);
  currentCompat = ff;
  let ended = false;

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Disposition": "inline",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  const cleanup = () => {
    if (ended) return;
    ended = true;
    if (currentCompat === ff) currentCompat = null;
    try {
      ff.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  };

  ff.stdout.pipe(reply.raw);
  ff.stderr.on("data", (chunk) => {
    req.log.warn({ ffmpeg: String(chunk) }, "compat-transcode");
  });
  ff.on("close", cleanup);
  req.raw.on("close", cleanup);
}

export async function registerStreamRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const row = mediaStore.get(id);
    if (!row) return reply.code(404).send({ error: "媒体不存在" });

    const url = await getDownloadUrl(row.item_id);
    const query = req.query as { proxy?: string; compat?: string; t?: string };

    if (query.compat === "1") {
      if (!(await hasFfmpeg())) {
        return reply.code(503).send({ error: "服务器未安装 ffmpeg，无法兼容转码" });
      }
      const startSec = Number(query.t);
      sendCompatStream(req, reply, url, Number.isFinite(startSec) ? startSec : 0);
      return;
    }

    if (query.proxy !== "1") {
      reply.header("Cache-Control", "no-store");
      return reply.redirect(url);
    }

    const headers: Record<string, string> = {};
    const range = req.headers.range;
    if (range) headers.Range = range;
    if (req.headers["user-agent"]) headers["User-Agent"] = String(req.headers["user-agent"]);

    const upstream = await fetchFollowingRedirects(url, headers);
    reply.code(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!hopByHop.has(key.toLowerCase())) reply.header(key, value);
    });
    reply.header("Content-Disposition", "inline");
    if (!reply.hasHeader("Accept-Ranges")) reply.header("Accept-Ranges", "bytes");
    if (req.method === "HEAD") {
      return reply.send();
    }
    if (!upstream.body) return reply.send();
    return reply.send(Readable.fromWeb(upstream.body as never));
  };

  app.get("/api/media/:id/stream", handler);
}
