export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = typeof data === "object" && data ? (data as Record<string, unknown>) : null;
    const message =
      (obj && (obj.message || obj.error) ? String(obj.message || obj.error) : "") ||
      (typeof data === "string" ? data : "") ||
      res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export type Settings = {
  clientId: string;
  clientSecret: string;
  hasClientSecret: boolean;
  tenant: string;
  redirectUri: string;
  publicBaseUrl: string;
  connected: boolean;
  displayName: string;
};

export type DriveBrowseItem = {
  id: string;
  name: string;
  folder: boolean;
  childCount: number;
  size: number;
  mime: string;
  durationSec: number;
  video: boolean;
};

export type MediaItem = {
  id: string;
  itemId: string;
  name: string;
  path: string;
  mime: string;
  ext: string;
  size: number;
  durationSec: number;
  introSec: number;
  outroSec: number;
  playableSec: number;
  webPlayable: boolean;
  createdAt: number;
};

export type ChannelSummary = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  logoFile: string;
  logoWidth: number;
  logoX: number;
  logoY: number;
  startAt: number;
  itemCount: number;
  now: { title: string; playhead: number; remaining: number } | null;
};

export type NowResponse = {
  empty: boolean;
  serverNow: number;
  channel: ChannelSummary;
  current?: {
    mediaId: string;
    title: string;
    durationSec: number;
    introSec: number;
    outroSec: number;
    playhead: number;
    remaining: number;
    webPlayable: boolean;
    streamUrl: string;
  };
  next?: { mediaId: string; title: string };
};

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
