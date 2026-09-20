export type Program = {
  mediaId: string;
  itemId: string;
  title: string;
  path: string;
  durationSec: number;
  ext: string;
  mime: string;
  webPlayable: boolean;
};

export type NowPlaying = {
  current: Program;
  next: Program;
  index: number;
  playhead: number;
  remaining: number;
  loopSec: number;
  elapsedInLoop: number;
};

export function toProgram(row: {
  id: string;
  item_id: string;
  name: string;
  path?: string;
  duration_sec: number;
  ext: string;
  mime: string;
  webPlayable?: boolean;
}): Program {
  return {
    mediaId: row.id,
    itemId: row.item_id,
    title: row.name,
    path: row.path || "",
    durationSec: row.duration_sec,
    ext: row.ext,
    mime: row.mime,
    webPlayable: row.webPlayable ?? true,
  };
}

export function getNowPlaying(
  programs: Program[],
  startAtMs: number,
  nowMs = Date.now(),
): NowPlaying | null {
  const items = programs.filter((p) => p.durationSec > 0);
  if (!items.length) return null;

  // 每集就是整集，不掐头去尾
  const playable = items.map((p) => ({ ...p, playable: p.durationSec }));
  const loopSec = playable.reduce((sum, p) => sum + p.playable, 0);
  let elapsed = ((nowMs - startAtMs) % (loopSec * 1000) + loopSec * 1000) % (loopSec * 1000);
  elapsed /= 1000;

  for (let i = 0; i < playable.length; i++) {
    const item = playable[i];
    if (elapsed < item.playable) {
      return {
        current: item,
        next: playable[(i + 1) % playable.length],
        index: i,
        playhead: elapsed,
        remaining: item.playable - elapsed,
        loopSec,
        elapsedInLoop: playable.slice(0, i).reduce((s, p) => s + p.playable, 0) + elapsed,
      };
    }
    elapsed -= item.playable;
  }
  return null;
}

export type ConcatEntry = {
  mediaId: string;
  inpoint: number;
  outpoint: number;
};

export function buildConcatWindow(
  programs: Program[],
  startAtMs: number,
  nowMs = Date.now(),
  minHours = 12,
): ConcatEntry[] {
  const now = getNowPlaying(programs, startAtMs, nowMs);
  if (!now) return [];
  const items = programs.filter((p) => p.durationSec > 0);
  const entries: ConcatEntry[] = [];

  // 第一集要从当前进度接上，后面的都从头放
  const firstOut = Math.max(1, now.current.durationSec);
  entries.push({
    mediaId: now.current.mediaId,
    inpoint: Math.min(now.playhead, firstOut - 0.2),
    outpoint: firstOut,
  });

  let acc = now.remaining;
  let idx = now.index;
  const target = minHours * 3600;
  let guard = 0;
  while (acc < target && guard < 5000) {
    idx = (idx + 1) % items.length;
    const item = items[idx];
    const outpoint = Math.max(1, item.durationSec);
    entries.push({ mediaId: item.mediaId, inpoint: 0, outpoint });
    acc += outpoint;
    guard += 1;
  }
  return entries;
}
