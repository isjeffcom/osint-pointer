import { type XPost } from "@/lib/types";

const NITTER_INSTANCES = ["https://nitter.poast.org", "https://nitter.privacydev.net", "https://nitter.net"];

/** 从 RSS item 中提取首张图片 URL（enclosure / media:content / description 内 img） */
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
    const link = text("link");
    const creator = text("dc:creator") || defaultAuthor || "unknown";
    const pubDate = text("pubDate");
    const imageUrl = extractFirstImageUrl(item);

    return {
      id: link.split("/").filter(Boolean).pop() ?? `rss-${idx}`,
      author: creator,
      content: title,
      link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
      ...(imageUrl ? { imageUrl } : {}),
    };
  }).filter((item) => item.content.length > 0);
}

/** Nitter 用户时间线常见 RSS 路径（不同实例可能不同） */
const USER_RSS_PATHS = ["/rss", "/with_replies/rss"];

/**
 * 从 Nitter 拉取指定 X 账号的推文 RSS（用户时间线）。
 * 多路径、多实例重试，提高可用性。
 */
export async function fetchXPostsByUser(
  username: string,
  limit = 25
): Promise<{ posts: XPost[]; sourceMode: "rss" | "mock" }> {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return { posts: [], sourceMode: "mock" };

  for (const instance of NITTER_INSTANCES) {
    for (const path of USER_RSS_PATHS) {
      const rssUrl = `${instance}/${encodeURIComponent(handle)}${path}`;
      try {
        const res = await fetch(rssUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0 osint-pointer" },
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes("<rss") || !xml.includes("<item>")) continue;
        const posts = parseRss(xml, handle).slice(0, limit);
        if (posts.length > 0) return { posts, sourceMode: "rss" };
      } catch {
        // next path or instance
      }
    }
  }

  return { posts: [], sourceMode: "mock" };
}

export async function fetchXPosts(query: string, limit = 8): Promise<{ posts: XPost[]; sourceMode: "rss" | "mock" }> {
  const clean = query.trim().replace(/\s+/g, " ");
  if (!clean) return { posts: [], sourceMode: "mock" };

  for (const instance of NITTER_INSTANCES) {
    const rssUrl = `${instance}/search/rss?f=tweets&q=${encodeURIComponent(clean)}`;
    try {
      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 osint-pointer" },
        cache: "no-store"
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<rss")) continue;
      const posts = parseRss(xml).slice(0, limit);
      if (posts.length > 0) return { posts, sourceMode: "rss" };
    } catch {
      // fallback to next instance
    }
  }

  const now = new Date().toISOString();
  return {
    sourceMode: "mock",
    posts: [
      {
        id: "mock-1",
        author: "open-source-intel",
        content: `Breaking: ${clean} reportedly escalated near a strategic site.`,
        link: "https://x.com/mock/1",
        publishedAt: now
      },
      {
        id: "mock-2",
        author: "geo-watcher",
        content: `New satellite image thread discusses movement linked to ${clean}.`,
        link: "https://x.com/mock/2",
        publishedAt: now
      },
      {
        id: "mock-3",
        author: "local-observer",
        content: `Unverified clips mention ${clean}; on-ground confirmation pending.`,
        link: "https://x.com/mock/3",
        publishedAt: now
      }
    ]
  };
}
