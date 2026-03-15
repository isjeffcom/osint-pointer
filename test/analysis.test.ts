import { describe, expect, it } from "vitest";
import { analyzePosts } from "../src/lib/analysis";

describe("analyzePosts", () => {
  it("returns bounded confidence and full signal set", () => {
    const posts = [
      { id: "1", author: "intel_monitor", content: "Confirmed video of incident", link: "x", publishedAt: new Date().toISOString() },
      { id: "2", author: "anon_burner", content: "Rumor maybe fake???", link: "x", publishedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() }
    ];

    const result = analyzePosts(posts);

    expect(result).toHaveLength(2);
    result.forEach((item) => {
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
      expect(["Likely credible", "Needs corroboration", "Low confidence"]).toContain(item.verdict);
      expect(item.signals).toHaveLength(4);
    });
  });

  it("is deterministic when a fixed analysis time is provided", () => {
    const fixedNow = new Date("2026-03-15T07:00:00.000Z");
    const posts = [
      {
        id: "a",
        author: "geo_observer",
        content: "Satellite image confirms movement",
        link: "x",
        publishedAt: "2026-03-15T05:00:00.000Z"
      }
    ];

    const first = analyzePosts(posts, { now: fixedNow });
    const second = analyzePosts(posts, { now: fixedNow });

    expect(first).toEqual(second);
  });
});
