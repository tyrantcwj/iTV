import type { FastifyInstance } from "fastify";
import { mediaStore } from "../db.js";
import { ffprobeDuration } from "../lib/ffmpeg.js";
import {
  durationFromItem,
  getDownloadUrl,
  getDriveItem,
  itemExt,
  itemPath,
  listChildren,
  listVideosRecursive,
} from "../lib/onedrive.js";
import { isVideoFile, isWebPlayable } from "../lib/util.js";

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function probeOne(id: string) {
  const row = mediaStore.get(id);
  if (!row) throw new Error("未找到");
  const item = await getDriveItem(row.item_id);
  let duration = durationFromItem(item);
  if (!(duration > 0)) {
    duration = await ffprobeDuration(await getDownloadUrl(row.item_id));
  }
  mediaStore.updateDuration(id, duration);
  return duration;
}

async function probeIds(ids: string[]) {
  return mapPool(ids, 3, async (id) => {
    try {
      const durationSec = await probeOne(id);
      return { id, durationSec, ok: true as const };
    } catch (err) {
      return {
        id,
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

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
        created_at: existing?.created_at || Date.now(),
      });
      return serialize(row);
    });
    const missing = imported.filter((item) => !item.durationSec).map((item) => item.id);
    if (missing.length) void probeIds(missing);
    return { imported };
  });

  app.patch("/api/media/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string };
    const patch: { name?: string } = {};
    if (body.name !== undefined) patch.name = body.name;
    mediaStore.updateOne(id, patch);
    const row = mediaStore.get(id);
    if (!row) return { error: "未找到" };
    return serialize(row);
  });

  app.post("/api/media/probe", async (req) => {
    const body = req.body as { ids?: string[] };
    return { results: await probeIds(body.ids || []) };
  });

  app.delete("/api/media", async (req) => {
    const body = req.body as { ids?: string[] };
    mediaStore.remove(body.ids || []);
    return { ok: true };
  });
}
