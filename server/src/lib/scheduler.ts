import { playableDuration } from "./util.js";

export type Program = {
  mediaId: string;
  itemId: string;
  title: string;
  durationSec: number;
  introSec: number;
  outroSec: number;
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
  duration_sec: number;
  intro_sec: number;
  outro_sec: number;
  ext: string;
  mime: string;
  webPlayable?: boolean;
}): Program {
  return {
    mediaId: row.id,
    itemId: row.item_id,
    title: row.name,
    durationSec: row.duration_sec,
    introSec: row.intro_sec,
    outroSec: row.outro_sec,
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

  const playable = items.map((p) => ({
    ...p,
    playable: playableDuration(p.durationSec, p.introSec, p.outroSec),
  }));
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
        playhead: item.introSec + elapsed,
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

  const firstOut = Math.max(now.current.introSec + 1, now.current.durationSec - now.current.outroSec);
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
    const inpoint = item.introSec;
    const outpoint = Math.max(inpoint + 1, item.durationSec - item.outroSec);
    entries.push({ mediaId: item.mediaId, inpoint, outpoint });
    acc += outpoint - inpoint;
    guard += 1;
  }
  return entries;
}
