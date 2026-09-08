import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mediaStore } from "../db.js";
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
]);

export async function registerStreamRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const row = mediaStore.get(id);
    if (!row) return reply.code(404).send({ error: "媒体不存在" });

    const url = await getDownloadUrl(row.item_id);
    const headers: Record<string, string> = {};
    const range = req.headers.range;
    if (range) headers.Range = range;
    if (req.headers["user-agent"]) headers["User-Agent"] = String(req.headers["user-agent"]);

    const upstream = await fetch(url, { headers, redirect: "follow" });
    reply.code(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!hopByHop.has(key.toLowerCase())) reply.header(key, value);
    });
    if (!reply.hasHeader("Accept-Ranges")) reply.header("Accept-Ranges", "bytes");
    if (req.method === "HEAD") {
      return reply.send();
    }
    if (!upstream.body) return reply.send();
    return reply.send(Readable.fromWeb(upstream.body as never));
  };

  app.get("/api/media/:id/stream", handler);
}
