import { type XPost } from "@/lib/types";
import { fetchXPostsByUser, fetchXPosts } from "@/lib/x-source";
// 信源列表：编辑 src/config/osint-sources.json 的 handles 可自定义，打包时读入
import sourcesConfig from "@/config/osint-sources.json";

const DEFAULT_OSINT_ACCOUNTS = [
  "osinttechnical", "conflict_radar", "sentdefender", "osintwarfare",
  "IntelCrab", "OSINTdefender", "ClashReport", "GeoConfirmed",
  "Osint613", "ConflictsW", "AggregateOsint", "MenchOsint",
];

/** 实际使用的账号列表：优先 JSON 配置，否则用默认 */
const OSINT_ACCOUNTS: string[] =
  Array.isArray((sourcesConfig as { handles?: string[] }).handles) &&
  (sourcesConfig as { handles: string[] }).handles.length > 0
    ? (sourcesConfig as { handles: string[] }).handles
    : DEFAULT_OSINT_ACCOUNTS;

/** 无时间窗内数据时，改用「最近 N 条」 */
const FALLBACK_LAST_N = 150;

function filterByTimeWindow(posts: XPost[], windowMs: number): XPost[] {
  const since = Date.now() - windowMs;
  return posts.filter((p) => {
    if (!p.publishedAt) return true;
    return new Date(p.publishedAt).getTime() >= since;
  });
}

function sortByTimeDesc(posts: XPost[]): XPost[] {
  return [...posts].sort((a, b) => {
    const tA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tB - tA;
  });
}

export type RecentOSINTResult = {
  posts: XPost[];
  sourceMode: "rss" | "mock";
  sourceDistribution: Record<string, number>;
  fetchedAt: string;
  /** 实际使用的时间窗口说明，供前端/LLM 展示 */
  windowLabel: string;
};

/** 单账号拉取：时间线优先，空则用搜索回退（部署环境如 Worker 下并行可减少总耗时） */
async function fetchOneAccount(
  account: string,
  maxPostsPerAccount: number
): Promise<{ account: string; posts: XPost[]; sourceMode: "rss" | "mock" }> {
  let { posts, sourceMode } = await fetchXPostsByUser(account, maxPostsPerAccount);
  if (posts.length === 0) {
    const search = await fetchXPosts(account, 20);
    posts = search.posts;
    if (search.sourceMode === "rss") sourceMode = "rss";
  }
  return { account, posts, sourceMode };
}

/**
 * 拉取 OSINT：并行请求所有账号（时间线 + 搜索回退），聚合后按时间窗过滤。
 * 默认近 6 小时，减少抓取量与上下文长度，利于 Worker 与 LLM 输出完整。
 */
export async function fetchRecentOSINT(
  windowHours: number = 6,
  maxPostsPerAccount: number = 40
): Promise<RecentOSINTResult> {
  const windowMs = windowHours * 60 * 60 * 1000;
  const seen = new Set<string>();
  const all: XPost[] = [];
  let sourceMode: "rss" | "mock" = "mock";
  const sourceDistribution: Record<string, number> = {};

  const results = await Promise.allSettled(
    OSINT_ACCOUNTS.map((account) => fetchOneAccount(account, maxPostsPerAccount))
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { account, posts, sourceMode: mode } = result.value;
    if (mode === "rss") sourceMode = "rss";
    const label = `@${account}`;
    for (const p of posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      all.push(p);
      sourceDistribution[label] = (sourceDistribution[label] ?? 0) + 1;
    }
  }

  const filtered = filterByTimeWindow(all, windowMs);
  const used = filtered.length > 0
    ? { posts: filtered, windowLabel: `近 ${windowHours} 小时` }
    : { posts: sortByTimeDesc(all).slice(0, FALLBACK_LAST_N), windowLabel: "近期（部分信源超出时间窗）" };

  return {
    posts: used.posts,
    sourceMode,
    sourceDistribution,
    fetchedAt: new Date().toISOString(),
    windowLabel: used.windowLabel,
  };
}
