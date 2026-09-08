import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { channelStore, getSettings, mediaStore, type ChannelRow } from "../db.js";
import { getNowPlaying, toProgram } from "../lib/scheduler.js";
import { isWebPlayable, publicUrl, slugify } from "../lib/util.js";

function logoUrl(row: ChannelRow): string {
  if (!row.logo_file) return "";
  const s = getSettings();
  const base = s.public_base_url || "";
  const pathname = `/api/uploads/logos/${row.logo_file}`;
  return base ? publicUrl(base, pathname) : pathname;
}

function serializeChannel(row: ChannelRow) {
  const items = channelStore.items(row.id);
  const programs = items.filter((m) => m.duration_sec > 0).map((m) =>
    toProgram({ ...m, webPlayable: isWebPlayable(m.ext, m.mime) }),
  );
  const now = getNowPlaying(programs, row.start_at);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: logoUrl(row),
    logoFile: row.logo_file,
    logoWidth: row.logo_width,
    logoX: row.logo_x,
    logoY: row.logo_y,
    startAt: row.start_at,
    itemCount: items.length,
    now: now
      ? { title: now.current.title, playhead: now.playhead, remaining: now.remaining }
      : null,
  };
}

function programsOf(channelId: string) {
  return channelStore.items(channelId).map((m) =>
    toProgram({ ...m, webPlayable: isWebPlayable(m.ext, m.mime) }),
  );
}

export async function registerChannelRoutes(app: FastifyInstance) {
  app.get("/api/channels", async () => ({
    items: channelStore.list().map(serializeChannel),
  }));

  app.post("/api/channels", async (req) => {
    const body = req.body as { name?: string; startAt?: number };
    const name = (body.name || "新频道").trim();
    const row: ChannelRow = {
      id: crypto.randomUUID(),
      name,
      slug: slugify(name) + "-" + crypto.randomUUID().slice(0, 4),
      logo_file: "",
      logo_width: 96,
      logo_x: 24,
      logo_y: 24,
      start_at: body.startAt || Date.now(),
      created_at: Date.now(),
    };
    channelStore.create(row);
    return serializeChannel(row);
  });

  app.get("/api/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = channelStore.get(id);
    if (!row) return reply.code(404).send({ error: "频道不存在" });
    const items = channelStore.items(row.id).map((m) => ({
      id: m.id,
      itemId: m.item_id,
      name: m.name,
      path: m.path,
      mime: m.mime,
      ext: m.ext,
      size: m.size,
      durationSec: m.duration_sec,
      introSec: m.intro_sec,
      outroSec: m.outro_sec,
      playableSec: Math.max(1, m.duration_sec - m.intro_sec - m.outro_sec),
      webPlayable: isWebPlayable(m.ext, m.mime),
      createdAt: m.created_at,
    }));
    return { ...serializeChannel(row), items };
  });

  app.put("/api/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = channelStore.get(id);
    if (!row) return reply.code(404).send({ error: "频道不存在" });
    const body = req.body as {
      name?: string;
      slug?: string;
      startAt?: number;
      logoWidth?: number;
      logoX?: number;
      logoY?: number;
      mediaIds?: string[];
    };
    if (body.name !== undefined) row.name = body.name.trim();
    if (body.slug !== undefined) row.slug = slugify(body.slug);
    if (body.startAt !== undefined) row.start_at = body.startAt;
    if (body.logoWidth !== undefined) row.logo_width = body.logoWidth;
    if (body.logoX !== undefined) row.logo_x = body.logoX;
    if (body.logoY !== undefined) row.logo_y = body.logoY;
    channelStore.update(row);
    if (body.mediaIds) {
      const valid = body.mediaIds.filter((mid) => mediaStore.get(mid));
      channelStore.setItems(row.id, valid);
    }
    return serializeChannel(row);
  });

  app.post("/api/channels/:id/logo", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = channelStore.get(id);
    if (!row) return reply.code(404).send({ error: "频道不存在" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "请上传台标图片" });
    const ext = path.extname(file.filename || "").toLowerCase() || ".png";
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) {
      return reply.code(400).send({ error: "仅支持 png / jpg / webp / gif / svg" });
    }
    const filename = `${row.id}${ext}`;
    const dest = path.join(config.dataDir, "logos", filename);
    await fs.promises.writeFile(dest, await file.toBuffer());
    if (row.logo_file && row.logo_file !== filename) {
      const old = path.join(config.dataDir, "logos", row.logo_file);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    row.logo_file = filename;
    channelStore.update(row);
    return serializeChannel(row);
  });

  app.delete("/api/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = channelStore.get(id);
    if (!row) return reply.code(404).send({ error: "频道不存在" });
    if (row.logo_file) {
      const f = path.join(config.dataDir, "logos", row.logo_file);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    channelStore.remove(row.id);
    return { ok: true };
  });

  app.get("/api/channels/:id/now", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = channelStore.get(id);
    if (!row) return reply.code(404).send({ error: "频道不存在" });
    const now = getNowPlaying(programsOf(row.id), row.start_at);
    if (!now) return { empty: true, serverNow: Date.now(), channel: serializeChannel(row) };
    return {
      empty: false,
      serverNow: Date.now(),
      channel: serializeChannel(row),
      current: {
        mediaId: now.current.mediaId,
        title: now.current.title,
        durationSec: now.current.durationSec,
        introSec: now.current.introSec,
        outroSec: now.current.outroSec,
        playhead: now.playhead,
        remaining: now.remaining,
        webPlayable: now.current.webPlayable,
        streamUrl: `/api/media/${now.current.mediaId}/stream`,
      },
      next: {
        mediaId: now.next.mediaId,
        title: now.next.title,
      },
    };
  });
}
