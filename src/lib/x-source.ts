import { type XPost } from "@/lib/types";

/** Nitter 实例列表 */
const NITTER_INSTANCES = [
  "https://nitter.poast.org",
  "https://nitter.privacydev.net",
  "https://nitter.net",
  "https://nitter.space",
  "https://xcancel.com",
  "https://nitter.privacyredirect.com",
  "https://nitter.catsarch.com",
];

/** RSSHub 公共实例，作为 Nitter 全部失败后的备用 */
const RSSHUB_INSTANCES = [
  "https://rsshub.app",
  "https://rsshub.rssforever.com",
  "https://rsshub.moeyy.cn",
];

const RSS_FETCH_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0 osint-pointer",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9",
};
const RSS_TIMEOUT_MS = 15000;

function extractFirstImageUrl(item: string): string | undefined {
  const enclosureMatch = item.match(/<enclosure\s[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']+["']/i)
    || item.match(/<enclosure\s[^>]*type=["']image\/[^"']+["'][^>]*url=["']([^"']+)["']/i);
  if (enclosureMatch?.[1]) return enclosureMatch[1].trim();
  const mediaMatch = item.match(/<media:content\s[^>]*url=["']([^"']+)["']/i);
  if (mediaMatch?.[1]) return mediaMatch[1].trim();
  const cdata = item.replace(/<!\[CDATA\[|\]\]>/g, "");
  const imgMatch = cdata.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) return imgMatch[1].trim();
  return undefined;
}

function parseRss(xml: string, defaultAuthor?: string): XPost[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  return items.map((item, idx) => {
    const text = (tag: string) => item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const title = text("title");
    const description = text("description");
    const link = text("link");
    const creator = text("dc:creator") || defaultAuthor || "unknown";
    const pubDate = text("pubDate");
    const imageUrl = extractFirstImageUrl(item);
    const content = title || description;

    return {
      id: link.split("/").filter(Boolean).pop() ?? `rss-${idx}`,
      author: creator,
      content,
      link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
      ...(imageUrl ? { imageUrl } : {}),
    };
  }).filter((item) => item.content.length > 0);
}

const USER_RSS_PATHS = ["/rss", "/with_replies/rss"];

/**
 * 从 Nitter 拉取指定 X 账号的推文 RSS。
 * 多路径、多实例重试。全部失败则尝试 RSSHub 备用。
 */
export async function fetchXPostsByUser(
  username: string,
  limit = 25
): Promise<{ posts: XPost[]; sourceMode: "rss" | "mock" }> {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return { posts: [], sourceMode: "mock" };

  // 1. Try Nitter instances
  for (const instance of NITTER_INSTANCES) {
    for (const path of USER_RSS_PATHS) {
      const rssUrl = `${instance}/${encodeURIComponent(handle)}${path}`;
      try {
        const res = await fetch(rssUrl, {
          headers: RSS_FETCH_HEADERS,
          cache: "no-store",
          signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes("<rss") || !xml.includes("<item>")) continue;
        const posts = parseRss(xml, handle).slice(0, limit);
        if (posts.length > 0) return { posts, sourceMode: "rss" };
      } catch {
        // next
      }
    }
  }

  // 2. Fallback: RSSHub instances
  for (const instance of RSSHUB_INSTANCES) {
    const rssUrl = `${instance}/twitter/user/${encodeURIComponent(handle)}`;
    try {
      const res = await fetch(rssUrl, {
        headers: RSS_FETCH_HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>")) continue;
      const posts = parseRss(xml, handle).slice(0, limit);
      if (posts.length > 0) return { posts, sourceMode: "rss" };
    } catch {
      // next
    }
  }

  return { posts: [], sourceMode: "mock" };
}

export async function fetchXPosts(query: string, limit = 8): Promise<{ posts: XPost[]; sourceMode: "rss" | "mock" }> {
  const clean = query.trim().replace(/\s+/g, " ");
  if (!clean) return { posts: [], sourceMode: "mock" };

  // 1. Try Nitter search
  for (const instance of NITTER_INSTANCES) {
    const rssUrl = `${instance}/search/rss?f=tweets&q=${encodeURIComponent(clean)}`;
    try {
      const res = await fetch(rssUrl, {
        headers: RSS_FETCH_HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<rss")) continue;
      const posts = parseRss(xml).slice(0, limit);
      if (posts.length > 0) return { posts, sourceMode: "rss" };
    } catch {
      // next
    }
  }

  // 2. Fallback: RSSHub keyword search
  for (const instance of RSSHUB_INSTANCES) {
    const rssUrl = `${instance}/twitter/keyword/${encodeURIComponent(clean)}`;
    try {
      const res = await fetch(rssUrl, {
        headers: RSS_FETCH_HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>")) continue;
      const posts = parseRss(xml).slice(0, limit);
      if (posts.length > 0) return { posts, sourceMode: "rss" };
    } catch {
      // next
    }
  }

  return { posts: [], sourceMode: "mock" };
}
