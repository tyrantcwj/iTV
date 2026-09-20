import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { channelStore, getSettings, mediaStore } from "../db.js";
import { hasFfmpeg } from "../lib/ffmpeg.js";
import { getDownloadUrl } from "../lib/onedrive.js";
import { buildConcatWindow, getNowPlaying, toProgram } from "../lib/scheduler.js";
import { isWebPlayable, programLabel, publicUrl } from "../lib/util.js";

function baseUrl(req: FastifyRequest): string {
  const s = getSettings();
  if (s.public_base_url) return s.public_base_url.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function programsOf(channelId: string) {
  return channelStore.items(channelId).map((m) =>
    toProgram({ ...m, webPlayable: isWebPlayable(m.ext, m.mime) }),
  );
}

function m3uLine(req: FastifyRequest, channel: ReturnType<typeof channelStore.list>[number]) {
  const base = baseUrl(req);
  const logo = channel.logo_file ? publicUrl(base, `/api/uploads/logos/${channel.logo_file}`) : "";
  const logoAttr = logo ? ` tvg-logo="${logo}"` : "";
  return `#EXTINF:-1 tvg-id="${channel.id}" tvg-name="${channel.name}"${logoAttr} group-title="虚拟电视台",${channel.name}\n${publicUrl(base, `/live/${channel.id}.m3u`)}`;
}

async function channelFilePlaylist(channel: ReturnType<typeof channelStore.list>[number]) {
  const programs = programsOf(channel.id).filter((p) => p.durationSec > 0);
  const now = getNowPlaying(programs, channel.start_at);
  if (!now) return "#EXTM3U\n";
  const items = programs.filter((p) => p.durationSec > 0);
  const count = Math.min(items.length, 24);
  const window = Array.from({ length: count }, (_, n) => items[(now.index + n) % items.length]);
  const urls = await Promise.all(
    window.map(async (item) => {
      const media = mediaStore.get(item.mediaId);
      return media ? getDownloadUrl(media.item_id) : "";
    }),
  );
  const lines = ["#EXTM3U"];
  window.forEach((item, n) => {
    const url = urls[n];
    if (!url) return;
    const playable = item.durationSec;
    const title = `${channel.name} · ${programLabel(item.path, item.title)}`;
    if (n === 0) lines.push(`#EXTVLCOPT:start-time=${Math.floor(now.playhead)}`);
    lines.push(`#EXTINF:${Math.max(1, Math.round(n === 0 ? now.remaining : playable))},${title}`);
    lines.push(url);
  });
  return lines.join("\n") + "\n";
}

function sendMasterPlaylist(req: FastifyRequest, reply: FastifyReply) {
  const lines = ["#EXTM3U"];
  for (const ch of channelStore.list()) {
    lines.push(m3uLine(req, ch));
  }
  reply.header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  reply.header("Content-Disposition", 'inline; filename="channels.m3u"');
  return lines.join("\n") + "\n";
}

export async function registerLiveRoutes(app: FastifyInstance) {
  app.get("/live/:filename", async (req: FastifyRequest, reply: FastifyReply) => {
    const filename = (req.params as { filename: string }).filename;
    if (filename === "playlist.m3u") return sendMasterPlaylist(req, reply);

    if (filename.endsWith(".m3u")) {
      const channel = channelStore.get(filename.slice(0, -4));
      if (!channel) return reply.code(404).send({ error: "频道不存在" });
      reply.header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      reply.header("Content-Disposition", 'inline; filename="channel.m3u"');
      return channelFilePlaylist(channel);
    }

    if (!filename.endsWith(".ts")) {
      return reply.code(404).send({ error: "Not found" });
    }

    const channel = channelStore.get(filename.slice(0, -3));
    if (!channel) return reply.code(404).send({ error: "频道不存在" });

    const programs = programsOf(channel.id).filter((p) => p.durationSec > 0);
    const now = getNowPlaying(programs, channel.start_at);
    if (!now) return reply.code(400).send({ error: "频道没有可播放节目（请先导入并探测时长）" });

    if (!(await hasFfmpeg())) {
      return reply.code(503).send({ error: "服务器未安装 ffmpeg，无法输出直播流" });
    }

    const entries = buildConcatWindow(programs, channel.start_at, Date.now(), 2);
    const listFile = path.join(os.tmpdir(), `live-${channel.id}-${crypto.randomUUID()}.txt`);
    const urls = await Promise.all(
      entries.map(async (entry) => {
        const media = mediaStore.get(entry.mediaId);
        return media
          ? await getDownloadUrl(media.item_id)
          : `${config.internalBaseUrl}/api/media/${entry.mediaId}/stream?proxy=1`;
      }),
    );
    const lines = ["ffconcat version 1.0"];
    entries.forEach((entry, i) => {
      lines.push(`file '${urls[i].replace(/'/g, "'\\''")}'`);
      lines.push(`inpoint ${entry.inpoint.toFixed(3)}`);
      lines.push(`outpoint ${entry.outpoint.toFixed(3)}`);
    });
    fs.writeFileSync(listFile, lines.join("\n"), "utf8");

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    });

    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-protocol_whitelist",
        "file,http,https,tcp,tls,crypto",
        "-safe",
        "0",
        "-f",
        "concat",
        "-i",
        listFile,
        "-c",
        "copy",
        "-f",
        "mpegts",
        "pipe:1",
      ],
      { windowsHide: true },
    );

    const cleanup = () => {
      try {
        ff.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(listFile);
      } catch {
        /* ignore */
      }
    };

    ff.stdout.pipe(reply.raw);
    ff.stderr.on("data", (chunk) => {
      req.log.warn({ ffmpeg: String(chunk) }, "ffmpeg");
    });
    ff.on("close", cleanup);
    req.raw.on("close", cleanup);
  });
}
