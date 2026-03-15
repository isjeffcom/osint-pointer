export type XPost = {
  id: string;
  author: string;
  content: string;
  link: string;
  publishedAt?: string;
};

export type AgentResult = {
  name: string;
  score: number;
  rationale: string;
};

export type ClaimAssessment = {
  claim: string;
  confidence: number;
  verdict: "Likely credible" | "Needs corroboration" | "Low confidence";
  signals: AgentResult[];
};

export type DashboardResponse = {
  query: string;
  posts: XPost[];
  assessments: ClaimAssessment[];
  sourceMode: "rss" | "mock";
};
