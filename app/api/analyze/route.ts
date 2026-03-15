import { NextRequest, NextResponse } from "next/server";
import { analyzePosts } from "@/lib/analysis";
import { fetchXPosts } from "@/lib/x-source";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") ?? 8)));

  if (query.length < 2) {
    return NextResponse.json({ error: "query must be at least 2 chars" }, { status: 400 });
  }

  const { posts, sourceMode } = await fetchXPosts(query, limit);
  const assessments = analyzePosts(posts);

  return NextResponse.json({
    query,
    posts,
    assessments,
    sourceMode
  });
}
