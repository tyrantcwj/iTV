import path from "node:path";
import Database from "better-sqlite3";
import { config, ensureDirs } from "./config.js";

ensureDirs();

const db = new Database(path.join(config.dataDir, "tv.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT DEFAULT '',
  client_secret TEXT DEFAULT '',
  tenant TEXT DEFAULT 'common',
  redirect_uri TEXT DEFAULT '',
  public_base_url TEXT DEFAULT '',
  refresh_token TEXT DEFAULT '',
  access_token TEXT DEFAULT '',
  access_expires_at INTEGER DEFAULT 0,
  display_name TEXT DEFAULT ''
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  item_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  path TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  ext TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  duration_sec REAL DEFAULT 0,
  intro_sec REAL DEFAULT 0,
  outro_sec REAL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_file TEXT DEFAULT '',
  logo_width INTEGER DEFAULT 96,
  logo_x INTEGER DEFAULT 24,
  logo_y INTEGER DEFAULT 24,
  start_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_items (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
`);

export type Settings = {
  id: number;
  client_id: string;
  client_secret: string;
  tenant: string;
  redirect_uri: string;
  public_base_url: string;
  refresh_token: string;
  access_token: string;
  access_expires_at: number;
  display_name: string;
};

export type MediaRow = {
  id: string;
  item_id: string;
  name: string;
  path: string;
  mime: string;
  ext: string;
  size: number;
  duration_sec: number;
  intro_sec: number;
  outro_sec: number;
  created_at: number;
};

export type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  logo_file: string;
  logo_width: number;
  logo_x: number;
  logo_y: number;
  start_at: number;
  created_at: number;
};

export type ChannelItemRow = {
  id: string;
  channel_id: string;
  media_id: string;
  sort_order: number;
};

export function getSettings(): Settings {
  return db.prepare("SELECT * FROM settings WHERE id = 1").get() as Settings;
}

export function updateSettings(patch: Partial<Omit<Settings, "id">>) {
  const current = getSettings();
  const next = { ...current, ...patch };
  db.prepare(
    `UPDATE settings SET
      client_id = @client_id,
      client_secret = @client_secret,
      tenant = @tenant,
      redirect_uri = @redirect_uri,
      public_base_url = @public_base_url,
      refresh_token = @refresh_token,
      access_token = @access_token,
      access_expires_at = @access_expires_at,
      display_name = @display_name
     WHERE id = 1`,
  ).run(next);
  return getSettings();
}

export const mediaStore = {
  list(): MediaRow[] {
    return db.prepare("SELECT * FROM media ORDER BY path, name").all() as MediaRow[];
  },
  get(id: string): MediaRow | undefined {
    return db.prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
  },
  getByItemId(itemId: string): MediaRow | undefined {
    return db.prepare("SELECT * FROM media WHERE item_id = ?").get(itemId) as MediaRow | undefined;
  },
  upsert(row: MediaRow) {
    db.prepare(
      `INSERT INTO media (id, item_id, name, path, mime, ext, size, duration_sec, intro_sec, outro_sec, created_at)
       VALUES (@id, @item_id, @name, @path, @mime, @ext, @size, @duration_sec, @intro_sec, @outro_sec, @created_at)
       ON CONFLICT(item_id) DO UPDATE SET
         name = excluded.name,
         path = excluded.path,
         mime = excluded.mime,
         ext = excluded.ext,
         size = excluded.size,
         duration_sec = CASE WHEN excluded.duration_sec > 0 THEN excluded.duration_sec ELSE media.duration_sec END`,
    ).run(row);
    return mediaStore.getByItemId(row.item_id)!;
  },
  updateSkip(ids: string[], introSec?: number, outroSec?: number) {
    const sets: string[] = [];
    const params: Record<string, unknown> = {};
    if (introSec !== undefined) {
      sets.push("intro_sec = @intro_sec");
      params.intro_sec = introSec;
    }
    if (outroSec !== undefined) {
      sets.push("outro_sec = @outro_sec");
      params.outro_sec = outroSec;
    }
    if (!sets.length || !ids.length) return;
    const placeholders = ids.map((_, i) => `@id${i}`).join(",");
    ids.forEach((id, i) => {
      params[`id${i}`] = id;
    });
    db.prepare(`UPDATE media SET ${sets.join(", ")} WHERE id IN (${placeholders})`).run(params);
  },
  updateDuration(id: string, durationSec: number) {
    db.prepare("UPDATE media SET duration_sec = ? WHERE id = ?").run(durationSec, id);
  },
  updateOne(
    id: string,
    patch: Partial<Pick<MediaRow, "intro_sec" | "outro_sec" | "duration_sec" | "name">>,
  ) {
    const current = mediaStore.get(id);
    if (!current) return;
    const next = { ...current, ...patch };
    db.prepare(
      `UPDATE media SET name = @name, duration_sec = @duration_sec, intro_sec = @intro_sec, outro_sec = @outro_sec WHERE id = @id`,
    ).run(next);
  },
  remove(ids: string[]) {
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM media WHERE id IN (${placeholders})`).run(...ids);
  },
};

export const channelStore = {
  list(): ChannelRow[] {
    return db.prepare("SELECT * FROM channels ORDER BY created_at").all() as ChannelRow[];
  },
  get(id: string): ChannelRow | undefined {
    return db
      .prepare("SELECT * FROM channels WHERE id = ? OR slug = ?")
      .get(id, id) as ChannelRow | undefined;
  },
  create(row: ChannelRow) {
    db.prepare(
      `INSERT INTO channels (id, name, slug, logo_file, logo_width, logo_x, logo_y, start_at, created_at)
       VALUES (@id, @name, @slug, @logo_file, @logo_width, @logo_x, @logo_y, @start_at, @created_at)`,
    ).run(row);
    return row;
  },
  update(row: ChannelRow) {
    db.prepare(
      `UPDATE channels SET
        name = @name,
        slug = @slug,
        logo_file = @logo_file,
        logo_width = @logo_width,
        logo_x = @logo_x,
        logo_y = @logo_y,
        start_at = @start_at
       WHERE id = @id`,
    ).run(row);
    return channelStore.get(row.id)!;
  },
  remove(id: string) {
    db.prepare("DELETE FROM channel_items WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM channels WHERE id = ?").run(id);
  },
  items(channelId: string): Array<ChannelItemRow & MediaRow> {
    return db
      .prepare(
        `SELECT ci.channel_id, ci.media_id, ci.sort_order,
                m.id, m.item_id, m.name, m.path, m.mime, m.ext, m.size,
                m.duration_sec, m.intro_sec, m.outro_sec, m.created_at
         FROM channel_items ci
         JOIN media m ON m.id = ci.media_id
         WHERE ci.channel_id = ?
         ORDER BY ci.sort_order`,
      )
      .all(channelId) as Array<ChannelItemRow & MediaRow>;
  },
  setItems(channelId: string, mediaIds: string[]) {
    db.prepare("DELETE FROM channel_items WHERE channel_id = ?").run(channelId);
    const insert = db.prepare(
      `INSERT INTO channel_items (id, channel_id, media_id, sort_order) VALUES (?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      mediaIds.forEach((mediaId, index) => {
        insert.run(crypto.randomUUID(), channelId, mediaId, index);
      });
    });
    tx();
  },
};

export { db };
