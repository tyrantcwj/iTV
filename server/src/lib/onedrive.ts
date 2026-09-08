import { config } from "../config.js";
import { getSettings, updateSettings } from "../db.js";
import { extOf, isVideoFile } from "./util.js";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  video?: { duration?: number };
  parentReference?: { path?: string };
};

let refreshLock: Promise<string> | null = null;
const oauthStates = new Map<string, number>();

function tenant(): string {
  return getSettings().tenant || "common";
}

export function authUrl(state: string): string {
  const s = getSettings();
  const url = new URL(`${config.china.authorize}/${tenant()}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", s.client_id);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", s.redirect_uri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", config.china.scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

export function createOAuthState(): string {
  const state = crypto.randomUUID();
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}

export function consumeOAuthState(state: string): boolean {
  const exp = oauthStates.get(state);
  oauthStates.delete(state);
  return Boolean(exp && exp > Date.now());
}

async function exchange(body: Record<string, string>): Promise<TokenResponse> {
  const s = getSettings();
  const res = await fetch(`${config.china.token}/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: s.client_id,
      client_secret: s.client_secret,
      ...body,
    }),
  });
  return (await res.json()) as TokenResponse;
}

export async function handleCode(code: string) {
  const s = getSettings();
  const token = await exchange({
    grant_type: "authorization_code",
    code,
    redirect_uri: s.redirect_uri,
    scope: config.china.scopes,
  });
  if (!token.access_token) {
    throw new Error(token.error_description || token.error || "授权失败");
  }
  updateSettings({
    access_token: token.access_token,
    refresh_token: token.refresh_token || s.refresh_token,
    access_expires_at: Date.now() + (token.expires_in || 3600) * 1000 - 60_000,
  });
  const me = await graph< { displayName?: string } >("/me");
  updateSettings({ display_name: me.displayName || "" });
}

async function accessToken(): Promise<string> {
  const s = getSettings();
  if (!s.refresh_token && !s.access_token) {
    const err = new Error("尚未连接 OneDrive");
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
  if (s.access_token && s.access_expires_at > Date.now() + 15_000) {
    return s.access_token;
  }
  if (!refreshLock) {
    refreshLock = (async () => {
      const cur = getSettings();
      const token = await exchange({
        grant_type: "refresh_token",
        refresh_token: cur.refresh_token,
        redirect_uri: cur.redirect_uri,
        scope: config.china.scopes,
      });
      if (!token.access_token) {
        throw new Error(token.error_description || token.error || "刷新令牌失败");
      }
      updateSettings({
        access_token: token.access_token,
        refresh_token: token.refresh_token || cur.refresh_token,
        access_expires_at: Date.now() + (token.expires_in || 3600) * 1000 - 60_000,
      });
      return token.access_token;
    })().finally(() => {
      refreshLock = null;
    });
  }
  return refreshLock;
}

export async function graph<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const url = pathname.startsWith("http") ? pathname : `${config.china.graph}${pathname}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export async function listChildren(itemId = "root"): Promise<DriveItem[]> {
  const path =
    itemId === "root"
      ? "/me/drive/root/children?$top=200&$select=id,name,folder,file,size,video,parentReference"
      : `/me/drive/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,folder,file,size,video,parentReference`;
  const items: DriveItem[] = [];
  let next: string | undefined = path;
  while (next) {
    const page = await graph<{ value: DriveItem[]; "@odata.nextLink"?: string }>(next);
    items.push(...(page.value || []));
    next = page["@odata.nextLink"];
  }
  return items.sort((a, b) => {
    const af = a.folder ? 0 : 1;
    const bf = b.folder ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name, "zh");
  });
}

export async function listVideosRecursive(itemId: string, prefix = ""): Promise<DriveItem[]> {
  const children = await listChildren(itemId);
  const videos: DriveItem[] = [];
  for (const child of children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.folder) {
      videos.push(...(await listVideosRecursive(child.id, path)));
    } else if (isVideoFile(child.name, child.file?.mimeType)) {
      videos.push({ ...child, parentReference: { path } });
    }
  }
  return videos;
}

export async function getDownloadUrl(itemId: string): Promise<string> {
  const item = await graph<Record<string, unknown>>(
    `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,@microsoft.graph.downloadUrl`,
  );
  const url = item["@microsoft.graph.downloadUrl"];
  if (typeof url !== "string" || !url) {
    throw new Error("无法获取下载地址");
  }
  return url;
}

export function durationFromItem(item: DriveItem): number {
  const ms = item.video?.duration;
  if (ms && ms > 0) return ms / 1000;
  return 0;
}

export function itemPath(item: DriveItem): string {
  if (item.parentReference?.path) return item.parentReference.path;
  return item.name;
}

export function itemExt(item: DriveItem): string {
  return extOf(item.name);
}
