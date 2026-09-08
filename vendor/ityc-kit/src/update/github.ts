import type { LatestCommit } from "./types.js";

const UA = "ityc-kit";

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": UA, Accept: "application/vnd.github+json" };
  const t = token?.trim();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function timeoutMs(): number {
  const n = Number(process.env.ITYC_KIT_HTTP_TIMEOUT_MS?.trim());
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}

/** 取仓库某分支的最新提交 */
export async function fetchLatestCommit(
  repo: string,
  branch = "main",
  token?: string,
): Promise<LatestCommit> {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders(token), signal: AbortSignal.timeout(timeoutMs()) });
  if (!res.ok) {
    throw new Error(`读取 ${repo}@${branch} 最新提交失败：HTTP ${res.status}${res.status === 404 ? "（仓库或分支不存在；私有仓库需要 token）" : ""}`);
  }
  const json = (await res.json()) as {
    sha?: string;
    commit?: { message?: string; committer?: { date?: string } };
  };
  if (!json.sha) throw new Error(`读取 ${repo}@${branch} 最新提交失败：响应里没有 sha`);
  return {
    commit: json.sha,
    message: String(json.commit?.message || "").split("\n")[0] ?? "",
    date: json.commit?.committer?.date,
  };
}

/** 源码 tarball 地址；有 token 时走 api.github.com 以便访问私有仓库 */
export function archiveUrl(repo: string, branch: string, token?: string): string {
  return token?.trim()
    ? `https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(branch)}`
    : `https://codeload.github.com/${repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`;
}

/**
 * 当前提交与最新提交是否不同。
 * 两边长度常常不一致（一个是短号一个是全号），按较短的那个前缀比。
 */
export function commitsDiffer(current: string, latest: string): boolean {
  const a = String(current || "").trim().toLowerCase();
  const b = String(latest || "").trim().toLowerCase();
  if (!a || !b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 7) return a !== b;
  return a.slice(0, n) !== b.slice(0, n);
}

export function shortSha(sha?: string): string {
  const s = String(sha || "").trim();
  return s ? s.slice(0, 7) : "";
}

export { ghHeaders };
