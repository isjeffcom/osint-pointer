import { NextResponse } from "next/server";
import { fetchRecentOSINT } from "@/lib/osint-feed";
import { analyzeBlackSwanWithLLM, samplePostsForContext } from "@/lib/llm-black-swan";
import {
  getOngoingState,
  putOngoingState,
  pruneOngoingEvents,
  formatOngoingContext,
  mergeOngoingFromEvents,
} from "@/lib/ongoing-kv";
import type { XPost } from "@/lib/types";
import type { KvBinding } from "@/lib/ongoing-kv";

/** 仅 Node 环境可用；动态 import 避免 Worker 构建时拉入 fs */
async function getNodeCache(): Promise<{
  readCache: () => unknown;
  writeCache: (payload: unknown) => void;
  isCacheAvailable: () => boolean;
} | null> {
  try {
    const mod = await import("@/lib/black-swan-cache");
    return mod as {
      readCache: () => unknown;
      writeCache: (payload: unknown) => void;
      isCacheAvailable: () => boolean;
    };
  } catch {
    return null;
  }
}

/** Worker 部署时从 Cloudflare 上下文取 KV 绑定，非 Worker 环境返回 undefined */
function getOngoingKvBinding(): KvBinding | undefined {
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const env = getCloudflareContext()?.env;
    const binding = env?.OSINT_POINTER_KV;
    if (binding && typeof binding.get === "function" && typeof binding.put === "function")
      return binding as KvBinding;
  } catch {
    // 非 Worker 或未绑定
  }
  return undefined;
}

export const dynamic = "force-dynamic";

/** 数据窗口：近 3 天；接口可每 30 分钟被调用一次以更新结果 */
const WINDOW_DAYS = 3;

/**
 * 完整数据分析流水线：近 30 分钟 OSINT 拉取 → LLM 黑天鹅分析 → 返回摘要与 Dashboard 指标。
 * 本地优先读 .cache/black-swan.json 缓存（5 分钟 TTL）；Cloudflare 部署无 fs，需改用 KV。
 */
export async function GET() {
  const apiKey =
    process.env.MINIMAX_API_KEY ??
    process.env.LLM_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "MISSING_LLM_API_KEY",
        message:
          "请配置环境变量 MINIMAX_API_KEY 或 LLM_API_KEY（MiniMax 密钥在 platform.minimax.io 获取）",
      },
      { status: 503 }
    );
  }

  const nodeCache = await getNodeCache();
  if (nodeCache?.isCacheAvailable()) {
    const cached = nodeCache.readCache();
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  try {
    const feed = await fetchRecentOSINT(WINDOW_DAYS, 40);
    if (feed.posts.length === 0) {
      return NextResponse.json(
        {
          error: "NO_OSINT_DATA",
          message: "当前无法从配置的 OSINT 信源拉取到数据，请稍后重试或检查网络与 Nitter 可用性。",
        },
        { status: 503 }
      );
    }
    const timeWindowLabel = feed.windowLabel ?? `近 ${WINDOW_DAYS} 天`;
    const orderedPosts = samplePostsForContext(feed.posts);

    const kv = getOngoingKvBinding();
    let ongoingContext = "";
    let prunedState: { updateId: number; events: { topic: string; lastSeen: number; summary?: string }[] } | null = null;
    if (kv) {
      const raw = await getOngoingState(kv);
      const state = raw ?? { updateId: 0, events: [] };
      prunedState = pruneOngoingEvents(state);
      ongoingContext = formatOngoingContext(prunedState);
    }

    const { summary, metrics } = await analyzeBlackSwanWithLLM(
      orderedPosts,
      timeWindowLabel,
      ongoingContext || undefined
    );

    if (kv && prunedState) {
      const ongoingEvents = summary.events.filter((e) => e.eventType === "ongoing").map((e) => ({
        parentTopic: e.parentTopic,
        title: e.title,
        causeEffect: e.causeEffect,
      }));
      const nextState = mergeOngoingFromEvents(prunedState, ongoingEvents);
      await putOngoingState(nextState, kv);
    }

    metrics.sourceDistribution = {
      ...metrics.sourceDistribution,
      ...feed.sourceDistribution,
    };

    if (feed.posts.length > 0 && !metrics.timeline?.length) {
      metrics.timeline = buildTimelineFromPosts(feed.posts);
    }

    const payload = {
      summary,
      metrics,
      meta: {
        sourceMode: feed.sourceMode,
        osintCount: feed.posts.length,
        fetchedAt: feed.fetchedAt,
        windowLabel: timeWindowLabel,
      },
      osintPosts: (orderedPosts.length > 0 ? orderedPosts : feed.posts).map((p) => ({
        id: p.id,
        author: p.author,
        content: p.content,
        link: p.link,
        publishedAt: p.publishedAt,
        ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
      })),
    };
    if (nodeCache?.isCacheAvailable()) nodeCache.writeCache(payload);
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "分析失败";
    return NextResponse.json(
      { error: "ANALYSIS_FAILED", message },
      { status: 500 }
    );
  }
}

function buildTimelineFromPosts(posts: XPost[]) {
  const sorted = [...posts]
    .filter((p) => p.publishedAt)
    .sort((a, b) => new Date(a.publishedAt!).getTime() - new Date(b.publishedAt!).getTime())
    .slice(-8);
  return sorted.map((p) => ({
    time: p.publishedAt!,
    label: p.content.slice(0, 60) + (p.content.length > 60 ? "…" : ""),
    type: "source" as const,
  }));
}
