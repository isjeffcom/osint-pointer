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

/** 无 3 天窗口数据时，改用「最近 N 条」 */
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

/**
 * 拉取 OSINT：从默认账号时间线聚合；某账号时间线失败则用该账号名搜索回退。
 * 默认抓取「近 3 天」数据（更新频率由调用方控制，如每 30 分钟执行一次）；若 3 天内 0 条则改用最近 N 条。
 */
export async function fetchRecentOSINT(
  windowDays: number = 3,
  maxPostsPerAccount: number = 40
): Promise<RecentOSINTResult> {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const all: XPost[] = [];
  let sourceMode: "rss" | "mock" = "mock";
  const sourceDistribution: Record<string, number> = {};

  for (const account of OSINT_ACCOUNTS) {
    let { posts, sourceMode: mode } = await fetchXPostsByUser(account, maxPostsPerAccount);
    if (mode === "rss") sourceMode = "rss";
    if (posts.length === 0) {
      const search = await fetchXPosts(account, 20);
      posts = search.posts;
      if (search.sourceMode === "rss") sourceMode = "rss";
    }
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
    ? { posts: filtered, windowLabel: `近 ${windowDays} 天` }
    : { posts: sortByTimeDesc(all).slice(0, FALLBACK_LAST_N), windowLabel: "近期（部分信源超出时间窗）" };

  return {
    posts: used.posts,
    sourceMode,
    sourceDistribution,
    fetchedAt: new Date().toISOString(),
    windowLabel: used.windowLabel,
  };
}
