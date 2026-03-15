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
});
