export type MediaSkipTarget = {
  id: string;
  name: string;
  path: string;
  duration_sec: number;
  intro_sec: number;
  outro_sec: number;
};

export type SkipCsvHit = {
  id: string;
  name: string;
  path: string;
  introSec: number;
  outroSec: number;
};

export type SkipCsvResult = {
  updated: SkipCsvHit[];
  unmatched: string[];
  skipped: string[];
  conflicts: string[];
};

const HEADER_MAP: Record<string, string> = {
  文件名: "file",
  文件: "file",
  片名: "file",
  filename: "file",
  file: "file",
  name: "file",
  片头起秒: "introStart",
  introstart: "introStart",
  片头止秒: "introEnd",
  introend: "introEnd",
  片头秒: "introSec",
  片头: "introSec",
  intro: "introSec",
  片尾起秒: "outroStart",
  outrostart: "outroStart",
  片尾止秒: "outroEnd",
  outroend: "outroEnd",
  片尾秒: "outroSec",
  片尾: "outroSec",
  outro: "outroSec",
};

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseNum(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function cnNum(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  if (s.startsWith("十")) return 10 + (CN_DIGIT[s.slice(1)] ?? 0);
  if (s.endsWith("十") && s.length === 2) return (CN_DIGIT[s[0]] ?? 0) * 10;
  if (s.includes("十") && s.length >= 3) {
    return (CN_DIGIT[s[0]] ?? 0) * 10 + (CN_DIGIT[s[s.length - 1]] ?? 0);
  }
  if (s.length === 1 && s in CN_DIGIT) return CN_DIGIT[s];
  return null;
}

export function parseSeasonEpisode(text: string): { season: number; episode: number } | null {
  const s = String(text || "");
  const cn = s.match(/第([一二三四五六七八九十两零〇\d]+)季.*?第([一二三四五六七八九十两零〇\d]+)集/);
  if (cn) {
    const season = cnNum(cn[1]);
    const episode = cnNum(cn[2]);
    if (season && episode) return { season, episode };
  }
  const se = s.match(/S(\d{1,2})\s*E(\d{1,3})/i);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };
  const folder = s.match(/(?:^|\/)(\d{1,2})\.[^/]*?(\d)[^/]*\/.*?(\d{1,3})\.\w+$/);
  if (folder) return { season: Number(folder[2]), episode: Number(folder[3]) };
  return null;
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;
}

type CsvRow = {
  file: string;
  introStart?: number;
  introEnd?: number;
  introSec?: number;
  outroStart?: number;
  outroEnd?: number;
  outroSec?: number;
};

export function parseSkipCsv(text: string): CsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const first = parseCsvLine(lines[0]).map((h) => HEADER_MAP[h.toLowerCase()] || HEADER_MAP[h] || "");
  const hasHeader = first.includes("file");
  const keys = hasHeader
    ? first
    : ["file", "introStart", "introEnd", "outroStart", "outroEnd"];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cols = parseCsvLine(line);
    const row: CsvRow = { file: "" };
    keys.forEach((key, i) => {
      const val = cols[i];
      if (!key) return;
      if (key === "file") row.file = val || "";
      else (row as Record<string, unknown>)[key] = parseNum(val);
    });
    return row;
  });
}

function introOf(row: CsvRow): number | undefined {
  if (row.introEnd != null) return Math.max(0, row.introEnd);
  if (row.introSec != null) return Math.max(0, row.introSec);
  return undefined;
}

function outroOf(row: CsvRow, durationSec: number): number | undefined {
  if (row.outroStart != null) {
    if (durationSec > 0) return Math.max(0, Math.round((durationSec - row.outroStart) * 1000) / 1000);
    if (row.outroEnd != null && row.outroEnd > row.outroStart) {
      return Math.max(0, Math.round((row.outroEnd - row.outroStart) * 1000) / 1000);
    }
    return undefined;
  }
  if (row.outroSec != null) return Math.max(0, row.outroSec);
  return undefined;
}

export function applySkipCsv(media: MediaSkipTarget[], csvText: string): SkipCsvResult {
  const rows = parseSkipCsv(csvText);
  const byName = new Map<string, MediaSkipTarget[]>();
  const bySe = new Map<string, MediaSkipTarget[]>();
  for (const item of media) {
    const name = basename(item.name).toLowerCase();
    byName.set(name, [...(byName.get(name) || []), item]);
    const se = parseSeasonEpisode(item.name) || parseSeasonEpisode(item.path);
    if (se) {
      const key = `${se.season}-${se.episode}`;
      bySe.set(key, [...(bySe.get(key) || []), item]);
    }
  }

  const updated: SkipCsvHit[] = [];
  const unmatched: string[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const label = row.file || "(空文件名)";
    const intro = introOf(row);
    const hasOutro = row.outroStart != null || row.outroSec != null;
    if (intro == null && !hasOutro) {
      skipped.push(label);
      continue;
    }
    const name = basename(row.file).toLowerCase();
    let hits = byName.get(name) || [];
    if (!hits.length) {
      const se = parseSeasonEpisode(row.file);
      if (se) hits = bySe.get(`${se.season}-${se.episode}`) || [];
    }
    if (!hits.length) {
      unmatched.push(label);
      continue;
    }
    if (hits.length > 1) {
      const uniqueShows = new Set(hits.map((h) => (parseSeasonEpisode(h.path || h.name)?.season ?? "") + h.name));
      if (uniqueShows.size > 1) {
        conflicts.push(label);
        continue;
      }
    }
    for (const item of hits) {
      if (seen.has(item.id)) continue;
      const outro = outroOf(row, item.duration_sec);
      const introSec = intro ?? item.intro_sec;
      const outroSec = outro ?? item.outro_sec;
      updated.push({
        id: item.id,
        name: item.name,
        path: item.path,
        introSec,
        outroSec,
      });
      seen.add(item.id);
    }
  }

  return { updated, unmatched, skipped, conflicts };
}
