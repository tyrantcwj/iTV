export const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "webm",
  "avi",
  "mov",
  "m4v",
  "ts",
  "m2ts",
  "wmv",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isVideoFile(name: string, mime = ""): boolean {
  if (mime.startsWith("video/")) return true;
  return VIDEO_EXTS.has(extOf(name));
}

export function isWebPlayable(ext: string, mime = ""): boolean {
  if (mime === "video/mp4" || mime === "video/webm") return true;
  return ext === "mp4" || ext === "webm" || ext === "m4v";
}

export function playableDuration(durationSec: number, introSec: number, outroSec: number): number {
  return Math.max(1, durationSec - introSec - outroSec);
}

export function parseTime(input: string | number | undefined | null): number {
  if (input === undefined || input === null || input === "") return 0;
  if (typeof input === "number") return Number.isFinite(input) ? Math.max(0, input) : 0;
  const s = String(input).trim();
  if (!s) return 0;
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return 0;
    if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function publicUrl(base: string, pathname: string): string {
  return `${base.replace(/\/$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "");
  return s || crypto.randomUUID().slice(0, 8);
}
