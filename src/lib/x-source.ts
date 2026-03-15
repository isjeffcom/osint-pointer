import { type XPost } from "@/lib/types";

const NITTER_INSTANCES = ["https://nitter.poast.org", "https://nitter.privacydev.net", "https://nitter.net"];

function parseRss(xml: string): XPost[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  return items.map((item, idx) => {
    const text = (tag: string) => item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const title = text("title");
    const link = text("link");
    const creator = text("dc:creator") || "unknown";
    const pubDate = text("pubDate");

    return {
      id: link.split("/").filter(Boolean).pop() ?? `rss-${idx}`,
      author: creator,
      content: title,
      link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined
    };
  }).filter((item) => item.content.length > 0);
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
