export type XPost = {
  id: string;
  author: string;
  content: string;
  link: string;
  publishedAt?: string;
  /** 推文首图 URL（来自 RSS enclosure/description），CDN 可外访时展示 */
  imageUrl?: string;
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
  meta?: {
    analyzedAt: string;
    execution: "edge-distributed";
    workerRegion: string | null;
  };
};

// --- 产品目标：近 30 分钟 OSINT → 黑天鹅事件 + 概率 + Dashboard ---

/** 单条证据：引用某条 OSINT 的摘要或原文片段，便于归因 */
export type EventEvidence = {
  /** 引用的 OSINT 条目编号，如 "1" 表示第一条 */
  ref: string;
  /** 证据摘要或原文片段 */
  quote: string;
};

/** 对全球金融/贸易的影响与正反建议（专业简报） */
export type FinanceTradeImpact = {
  /** 正面或机会面（如避险资产、某板块受益、建议） */
  positive?: string;
  /** 负面或风险面（如供应链、汇率、建议规避） */
  negative?: string;
};

/** 事件类型：持续（如俄乌冲突）vs 新兴 */
export type EventType = "ongoing" | "emerging";

/** 单个黑天鹅事件（简报式：具体地点、事件、前因后果 + 证据来源 + 金融贸易影响 + 连贯性） */
export type BlackSwanEvent = {
  id: string;
  title: string;
  location?: string;
  causeEffect?: string;
  probability: number;
  rationale: string;
  evidence?: EventEvidence[];
  sourceCount?: number;
  timeWindow?: string;
  category?: string;
  /** 对全球金融与贸易的影响及正反建议（专业分析） */
  financeTradeImpact?: FinanceTradeImpact;
  /** 持续事件（如俄乌冲突）vs 新兴事件 */
  eventType?: EventType;
  /** 持续事件所属主题，如「俄乌冲突」「中东局势」 */
  parentTopic?: string;
};

/** 近 30 分钟 OSINT 汇总 → 黑天鹅事件列表（供顶部展示） */
export type BlackSwanSummary = {
  updatedAt: string;
  timeWindow: string;
  events: BlackSwanEvent[];
};

/** 时间线节点（必须有 label，用于图表展示） */
export type TimelineNode = {
  time: string;
  label: string;
  type: string;
  /** 可选：对应 OSINT 条目编号 */
  ref?: string;
};

/** Dashboard：时间线、来源分布、风险等级等 */
export type DashboardMetrics = {
  updatedAt: string;
  timeline?: TimelineNode[];
  sourceDistribution?: Record<string, number>;
  riskLevel?: "low" | "medium" | "high" | "critical";
};

/** API 返回的原始 OSINT 列表，供前端展示证据来源 */
export type OSINTMeta = {
  posts: XPost[];
  fetchedAt: string;
};
