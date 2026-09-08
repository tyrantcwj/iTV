import type { FastifyInstance } from "fastify";
import { mediaStore } from "../db.js";
import { ffprobeDuration } from "../lib/ffmpeg.js";
import {
  durationFromItem,
  getDownloadUrl,
  itemExt,
  itemPath,
  listChildren,
  listVideosRecursive,
} from "../lib/onedrive.js";
import { isVideoFile, isWebPlayable, parseTime } from "../lib/util.js";

function serialize(row: ReturnType<typeof mediaStore.list>[number]) {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    path: row.path,
    mime: row.mime,
    ext: row.ext,
    size: row.size,
    durationSec: row.duration_sec,
    introSec: row.intro_sec,
    outroSec: row.outro_sec,
    playableSec: Math.max(1, row.duration_sec - row.intro_sec - row.outro_sec),
    webPlayable: isWebPlayable(row.ext, row.mime),
    createdAt: row.created_at,
  };
}

export async function registerMediaRoutes(app: FastifyInstance) {
  app.get("/api/onedrive/browse", async (req) => {
    const { itemId } = req.query as { itemId?: string };
    const items = await listChildren(itemId || "root");
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        folder: Boolean(item.folder),
        childCount: item.folder?.childCount || 0,
        size: item.size || 0,
        mime: item.file?.mimeType || "",
        durationSec: durationFromItem(item),
        video: isVideoFile(item.name, item.file?.mimeType),
      })),
    };
  });

  app.get("/api/media", async () => ({
    items: mediaStore.list().map(serialize),
  }));

  app.post("/api/media/import", async (req) => {
    const body = req.body as { itemIds?: string[]; folderId?: string };
    let items = [];
    if (body.folderId) {
      items = await listVideosRecursive(body.folderId);
    } else if (body.itemIds?.length) {
      const { graph } = await import("../lib/onedrive.js");
      items = [];
      for (const id of body.itemIds) {
        const item = await graph<Awaited<ReturnType<typeof listChildren>>[number]>(
          `/me/drive/items/${encodeURIComponent(id)}?$select=id,name,folder,file,size,video,parentReference`,
        );
        if (item.folder) items.push(...(await listVideosRecursive(item.id, item.name)));
        else if (isVideoFile(item.name, item.file?.mimeType)) items.push(item);
      }
    } else {
      return { imported: [] };
    }

    const imported = items.map((item) => {
      const existing = mediaStore.getByItemId(item.id);
      const ext = itemExt(item);
      const row = mediaStore.upsert({
        id: existing?.id || crypto.randomUUID(),
        item_id: item.id,
        name: item.name,
        path: itemPath(item),
        mime: item.file?.mimeType || "",
        ext,
        size: item.size || 0,
        duration_sec: durationFromItem(item) || existing?.duration_sec || 0,
        intro_sec: existing?.intro_sec || 0,
        outro_sec: existing?.outro_sec || 0,
        created_at: existing?.created_at || Date.now(),
      });
      return serialize(row);
    });
    return { imported };
  });

  app.post("/api/media/skip", async (req) => {
    const body = req.body as { ids?: string[]; intro?: string | number; outro?: string | number };
    const ids = body.ids || [];
    mediaStore.updateSkip(
      ids,
      body.intro !== undefined ? parseTime(body.intro) : undefined,
      body.outro !== undefined ? parseTime(body.outro) : undefined,
    );
    return { items: mediaStore.list().filter((m) => ids.includes(m.id)).map(serialize) };
  });

  app.patch("/api/media/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { intro?: string | number; outro?: string | number; name?: string };
    const patch: { intro_sec?: number; outro_sec?: number; name?: string } = {};
    if (body.intro !== undefined) patch.intro_sec = parseTime(body.intro);
    if (body.outro !== undefined) patch.outro_sec = parseTime(body.outro);
    if (body.name !== undefined) patch.name = body.name;
    mediaStore.updateOne(id, patch);
    const row = mediaStore.get(id);
    if (!row) return { error: "未找到" };
    return serialize(row);
  });

  app.post("/api/media/probe", async (req) => {
    const body = req.body as { ids?: string[] };
    const ids = body.ids || [];
    const results = [];
    for (const id of ids) {
      const row = mediaStore.get(id);
      if (!row) continue;
      try {
        const url = await getDownloadUrl(row.item_id);
        const duration = await ffprobeDuration(url);
        mediaStore.updateDuration(id, duration);
        results.push({ id, durationSec: duration, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  });

  app.delete("/api/media", async (req) => {
    const body = req.body as { ids?: string[] };
    mediaStore.remove(body.ids || []);
    return { ok: true };
  });
}
