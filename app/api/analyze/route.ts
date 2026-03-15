import { NextRequest, NextResponse } from "next/server";
import { analyzePosts } from "@/lib/analysis";
import { fetchXPosts } from "@/lib/x-source";

export const runtime = "edge";

function detectWorkerRegion(req: NextRequest): string | null {
  const header = req.headers.get("cf-ray");
  if (!header) return null;
  const parts = header.split("-");
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") ?? 8)));

  if (query.length < 2) {
    return NextResponse.json({ error: "query must be at least 2 chars" }, { status: 400 });
  }

  const analyzedAt = new Date();
  const { posts, sourceMode } = await fetchXPosts(query, limit);
  const assessments = analyzePosts(posts, { now: analyzedAt });

  return NextResponse.json({
    query,
    posts,
    assessments,
    sourceMode,
    meta: {
      analyzedAt: analyzedAt.toISOString(),
      execution: "edge-distributed",
      workerRegion: detectWorkerRegion(req)
    }
  });
}
