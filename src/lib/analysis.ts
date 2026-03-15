import { type AgentResult, type ClaimAssessment, type XPost } from "@/lib/types";

const suspiciousPatterns = [/rumou?r/i, /unverified/i, /hearing/i, /maybe/i, /\?\?+/];
const evidencePatterns = [/video/i, /image/i, /satellite/i, /source/i, /confirmed/i];
const stopWords = new Set(["with", "this", "that", "from", "have", "been", "about", "report", "reportedly", "breaking"]);

const clamp = (n: number) => Math.max(0, Math.min(1, n));

type AnalyzeOptions = {
  now?: Date;
};

function sourceReputation(post: XPost): AgentResult {
  let score = 0.45;
  const author = post.author.toLowerCase();
  if (["news", "intel", "monitor", "observer"].some((k) => author.includes(k))) score += 0.25;
  if (["anon", "new", "burner"].some((k) => author.includes(k))) score -= 0.2;

  return {
    name: "source_reputation",
    score: clamp(score),
    rationale: `Author handle ${post.author} evaluated with baseline trust heuristics.`
  };
}

function contentEvidence(post: XPost): AgentResult {
  const text = post.content.toLowerCase();
  const evidenceHits = evidencePatterns.filter((p) => p.test(text)).length;
  const suspiciousHits = suspiciousPatterns.filter((p) => p.test(text)).length;
  const score = 0.35 + evidenceHits * 0.18 - suspiciousHits * 0.15;

  return {
    name: "content_evidence",
    score: clamp(score),
    rationale: `Detected ${evidenceHits} evidence markers and ${suspiciousHits} uncertainty markers.`
  };
}

function temporalConsistency(post: XPost, now: Date): AgentResult {
  if (!post.publishedAt) {
    return { name: "temporal_consistency", score: 0.5, rationale: "Missing timestamp; assigned neutral temporal score." };
  }
  const ageHours = (now.getTime() - new Date(post.publishedAt).getTime()) / 3_600_000;
  const score = 0.3 + 0.6 * Math.exp(-Math.max(ageHours, 0) / 72);
  return {
    name: "temporal_consistency",
    score: clamp(score),
    rationale: `Post age is ${ageHours.toFixed(1)}h; fresher claims score higher.`
  };
}

function consensusMap(posts: XPost[]): Map<string, AgentResult> {
  const tokenSets = posts.map((p) => new Set((p.content.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !stopWords.has(w))));
  const freq = new Map<string, number>();

  tokenSets.forEach((set) => {
    set.forEach((token) => freq.set(token, (freq.get(token) ?? 0) + 1));
  });

  return new Map(
    posts.map((post, i) => {
      const tokens = [...tokenSets[i]];
      const shared = tokens.filter((token) => (freq.get(token) ?? 0) > 1);
      const ratio = shared.length / Math.max(tokens.length, 1);
      const score = clamp(0.2 + ratio * 0.75);
      return [
        post.id,
        {
          name: "cross_post_consensus",
          score,
          rationale: `${shared.length} key tokens overlap with other posts (ratio ${ratio.toFixed(2)}).`
        }
      ];
    })
  );
}

function verdict(confidence: number): ClaimAssessment["verdict"] {
  if (confidence >= 0.75) return "Likely credible";
  if (confidence >= 0.5) return "Needs corroboration";
  return "Low confidence";
}

export function analyzePosts(posts: XPost[], options: AnalyzeOptions = {}): ClaimAssessment[] {
  const now = options.now ?? new Date();
  const consensus = consensusMap(posts);

  return posts.map((post) => {
    const signals = [sourceReputation(post), contentEvidence(post), temporalConsistency(post, now), consensus.get(post.id)!];
    const confidence = Number((signals.reduce((sum, s) => sum + s.score, 0) / signals.length).toFixed(3));
    return {
      claim: post.content,
      confidence,
      verdict: verdict(confidence),
      signals
    };
  });
}
