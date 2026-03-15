import type {
  BlackSwanEvent,
  BlackSwanSummary,
  DashboardMetrics,
  XPost,
} from "@/lib/types";

const MINIMAX_BASE_URL = "https://api.minimax.io";
const MINIMAX_CHAT_PATH = "/v1/text/chatcompletion_v2";
const MINIMAX_DEFAULT_MODEL = "MiniMax-M2.1-highspeed";

function getLLMConfig() {
  const apiKey =
    process.env.MINIMAX_API_KEY ??
    process.env.LLM_API_KEY ??
    process.env.OPENAI_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? MINIMAX_BASE_URL;
  const model = process.env.LLM_MODEL ?? MINIMAX_DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

function isMinimax(baseUrl: string): boolean {
  return /minimax\.(io|chat)/i.test(baseUrl);
}

const MAX_CONTEXT_POSTS = 80;
const POST_CONTENT_MAX_CHARS = 200;

/** 截断 post 内容，避免长推文占用过多 input tokens */
function truncateContent(content: string): string {
  if (content.length <= POST_CONTENT_MAX_CHARS) return content;
  return content.slice(0, POST_CONTENT_MAX_CHARS) + "…";
}

/** 按时间分组并采样，总条数不超 MAX_CONTEXT_POSTS */
export function samplePostsForContext(posts: XPost[]): XPost[] {
  if (posts.length === 0) return [];
  const withDate = posts
    .filter((p) => p.publishedAt)
    .map((p) => ({ ...p, dayKey: new Date(p.publishedAt!).toDateString() }));
  const byDay = new Map<string, typeof withDate>();
  for (const p of withDate) {
    if (!byDay.has(p.dayKey)) byDay.set(p.dayKey, []);
    byDay.get(p.dayKey)!.push(p);
  }
  const days = [...byDay.keys()].sort();
  const perDay = Math.ceil(MAX_CONTEXT_POSTS / Math.max(1, days.length));
  const sampled: XPost[] = [];
  let index = 0;
  for (const day of days) {
    const dayPosts = byDay.get(day)!;
    const take = Math.min(perDay, dayPosts.length);
    const slice = dayPosts.slice(0, take);
    for (const p of slice) {
      sampled.push(p);
      index++;
      if (index >= MAX_CONTEXT_POSTS) break;
    }
    if (index >= MAX_CONTEXT_POSTS) break;
  }
  return sampled.length > 0 ? sampled : posts.slice(0, MAX_CONTEXT_POSTS);
}

function buildOSINTContext(orderedPosts: XPost[]): string {
  if (orderedPosts.length === 0) {
    return "（当前无 OSINT 条目。）";
  }
  let out = "";
  let lastDay = "";
  orderedPosts.forEach((p, i) => {
    const dayKey = p.publishedAt ? new Date(p.publishedAt).toDateString() : "";
    if (dayKey && dayKey !== lastDay) {
      const d = new Date(p.publishedAt!);
      out += `\n--- ${d.getMonth() + 1}月${d.getDate()}日 ---\n`;
      lastDay = dayKey;
    }
    const time = p.publishedAt ? new Date(p.publishedAt).toLocaleString("zh-CN") : "时间未知";
    out += `[${i + 1}] ${time} @${p.author}: ${truncateContent(p.content)}\n`;
  });
  return out.trim();
}

/** 只送部分 refs 的帖子，用于 Step 2 */
function buildPartialContext(orderedPosts: XPost[], refs: number[]): string {
  const refSet = new Set(refs);
  const lines: string[] = [];
  for (const ref of refs) {
    const idx = ref - 1;
    if (idx < 0 || idx >= orderedPosts.length) continue;
    const p = orderedPosts[idx];
    const time = p.publishedAt ? new Date(p.publishedAt).toLocaleString("zh-CN") : "时间未知";
    lines.push(`[${ref}] ${time} @${p.author}: ${truncateContent(p.content)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "（无相关条目）";
}

// ---------------------------------------------------------------------------
// Step 1: Topic Scan prompt — 输出极小（~400 tokens）
// ---------------------------------------------------------------------------
const TOPIC_SCAN_PROMPT = `你是 OSINT 情报分类员。用户给你一批 OSINT 条目（编号 [1][2]…）。
请识别其中 5–10 个不同的议题/事件，对同一议题的多条报道合并。

输出规则：
- 只输出一个合法 JSON，不要 markdown 代码块或其它文字
- 格式：
{
  "topics": [
    {
      "name": "议题名称（具体：国家/地区+事件）",
      "type": "ongoing 或 emerging",
      "parentTopic": "仅 ongoing 时填写，如「俄乌冲突」",
      "refs": [1, 3, 7],
      "category": "地缘/政策/市场/灾害/其他"
    }
  ],
  "riskLevel": "low/medium/high/critical"
}
- refs 为支撑该议题的条目编号数组
- name 必须具体（哪个国家、什么事件），不得用「某地」「某国」
- 不要输出任何分析、概率、依据等，只分类`;

// ---------------------------------------------------------------------------
// Step 2: Detail per topic prompt — 每次只分析 1 个事件（~500 tokens output）
// ---------------------------------------------------------------------------
const DETAIL_PROMPT = `你是 OSINT 情报简报员。用户会给你一个议题名称和相关的 OSINT 条目。
请针对该议题输出 1 个事件的完整分析。

输出规则：
- 只输出一个合法 JSON 对象，不要 markdown 代码块或其它文字
- 格式：
{
  "title": "具体事件标题（含地点或主体）",
  "location": "具体地区/国家/机构",
  "causeEffect": "一两句话简述前因后果或最新进展",
  "probability": 0.35,
  "rationale": "分析依据概括（1-2句）",
  "category": "地缘/政策/市场/灾害/其他",
  "eventType": "ongoing 或 emerging",
  "parentTopic": "仅 ongoing 时填写",
  "sourceCount": 3,
  "financeTradeImpact": {
    "positive": "正面/机会（1句）",
    "negative": "负面/风险（1句）"
  },
  "evidence": [
    { "ref": "1", "quote": "原文片段摘要" }
  ]
}
- evidence 至少 1 条、最多 3 条
- probability 为 0~1 的置信度
- 必须具体，不得用「某战略地点」等笼统表述`;

// ---------------------------------------------------------------------------
// LLM types
// ---------------------------------------------------------------------------
type TopicScanResult = {
  topics: Array<{
    name: string;
    type: "ongoing" | "emerging";
    parentTopic?: string;
    refs: number[];
    category?: string;
  }>;
  riskLevel: "low" | "medium" | "high" | "critical";
};

export type LLMEventRaw = {
  title: string;
  location?: string;
  causeEffect?: string;
  probability: number;
  rationale: string;
  category?: string;
  eventType?: "ongoing" | "emerging";
  parentTopic?: string;
  sourceCount?: number;
  financeTradeImpact?: { positive?: string; negative?: string };
  evidence?: Array<{ ref: string; quote: string }>;
};

export type LLMAnalysisResult = {
  events: LLMEventRaw[];
  riskLevel: "low" | "medium" | "high" | "critical";
  timeline: Array<{ time: string; label: string; type: string; ref?: string }>;
};

// ---------------------------------------------------------------------------
// JSON parsing utilities
// ---------------------------------------------------------------------------

function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error("LLM 未返回有效 JSON");
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let quote = "";
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; continue; }
    if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack.length === 0) return trimmed.slice(start, i + 1);
      const expected = stack.pop();
      if (c !== expected) continue;
      if (stack.length === 0) return trimmed.slice(start, i + 1);
    }
  }
  if (stack.length === 0) throw new Error("LLM 返回的 JSON 不完整");
  return trimmed.slice(start) + stack.reverse().join("");
}

function sanitizeJsonControlChars(jsonStr: string): string {
  let result = "";
  let i = 0;
  let inStr = false;
  let esc = false;
  let q = "";
  while (i < jsonStr.length) {
    const c = jsonStr[i];
    if (esc) { result += c; esc = false; i++; continue; }
    if (inStr) {
      if (c === "\\") { result += c; esc = true; i++; continue; }
      if (c === q) { inStr = false; result += c; i++; continue; }
      if (c === "\n") { result += "\\n"; i++; continue; }
      if (c === "\r") { result += "\\r"; i++; continue; }
      if (c === "\t") { result += "\\t"; i++; continue; }
      if (c.charCodeAt(0) < 32) { result += " "; i++; continue; }
      result += c; i++; continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; result += c; i++; continue; }
    result += c; i++;
  }
  return result;
}

function parseJSON<T>(text: string): T {
  const jsonStr = sanitizeJsonControlChars(extractFirstJsonObject(text));
  return JSON.parse(jsonStr) as T;
}

// ---------------------------------------------------------------------------
// Core: callLLM — single reusable LLM call
// ---------------------------------------------------------------------------

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 2048
): Promise<string> {
  const { apiKey, baseUrl, model } = getLLMConfig();
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY 或 LLM_API_KEY");

  const useMinimax = isMinimax(baseUrl);
  const url = useMinimax
    ? `${baseUrl.replace(/\/$/, "")}${MINIMAX_CHAT_PATH}`
    : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
  };
  if (useMinimax) {
    body.max_tokens = maxTokens;
  } else if (baseUrl.includes("openai.com")) {
    body.response_format = { type: "json_object" };
    body.max_tokens = maxTokens;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM 请求失败 ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    base_resp?: { status_code?: number; status_msg?: string };
  };

  if (data.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0) {
    throw new Error(data.base_resp.status_msg || `MiniMax 错误码 ${data.base_resp.status_code}`);
  }

  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!content) throw new Error("LLM 未返回内容");
  return content;
}

// ---------------------------------------------------------------------------
// Step 1: scanTopics
// ---------------------------------------------------------------------------

async function scanTopics(
  orderedPosts: XPost[],
  timeWindow: string,
  ongoingContext?: string
): Promise<TopicScanResult> {
  const context = buildOSINTContext(orderedPosts);
  const ongoingBlock = ongoingContext?.trim()
    ? `\n近期持续事件（供参考）：\n${ongoingContext}\n\n`
    : "";
  const userPrompt = `${ongoingBlock}以下为「${timeWindow}」的 OSINT 条目，请分类出 5–10 个议题：\n\n${context}`;

  const raw = await callLLM(TOPIC_SCAN_PROMPT, userPrompt, 2048);
  const result = parseJSON<TopicScanResult>(raw);

  if (!Array.isArray(result.topics) || result.topics.length === 0) {
    throw new Error("Step 1 未返回有效 topics");
  }
  if (!result.riskLevel) result.riskLevel = "medium";

  return result;
}

// ---------------------------------------------------------------------------
// Step 2: analyzeOneTopic
// ---------------------------------------------------------------------------

async function analyzeOneTopic(
  topicName: string,
  topicType: "ongoing" | "emerging",
  parentTopic: string | undefined,
  category: string | undefined,
  orderedPosts: XPost[],
  refs: number[]
): Promise<LLMEventRaw | null> {
  const context = buildPartialContext(orderedPosts, refs);
  const userPrompt = `议题：${topicName}\n类型：${topicType}${parentTopic ? `\n所属主题：${parentTopic}` : ""}${category ? `\n分类：${category}` : ""}\n\n相关 OSINT 条目：\n${context}`;

  try {
    const raw = await callLLM(DETAIL_PROMPT, userPrompt, 2048);
    const event = parseJSON<LLMEventRaw>(raw);
    if (!event.title) return null;
    return event;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API: analyzeBlackSwanWithLLM (ReAct two-step)
// ---------------------------------------------------------------------------

export async function analyzeBlackSwanWithLLM(
  posts: XPost[],
  timeWindow: string = "近 6 小时",
  ongoingContext?: string
): Promise<{ summary: BlackSwanSummary; metrics: DashboardMetrics }> {
  const { apiKey } = getLLMConfig();
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY 或 LLM_API_KEY，请在环境变量中设置");

  // Step 1: Topic Scan
  const scan = await scanTopics(posts, timeWindow, ongoingContext);

  // Step 2: Detail per topic (parallel)
  const detailResults = await Promise.allSettled(
    scan.topics.slice(0, 10).map((t) =>
      analyzeOneTopic(t.name, t.type as "ongoing" | "emerging", t.parentTopic, t.category, posts, t.refs)
    )
  );

  const now = new Date().toISOString();
  const events: BlackSwanEvent[] = [];

  for (let i = 0; i < detailResults.length; i++) {
    const result = detailResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;
    const e = result.value;
    events.push({
      id: `bs-${events.length + 1}`,
      title: e.title || "未命名事件",
      location: e.location,
      causeEffect: e.causeEffect,
      probability: Math.max(0, Math.min(1, Number(e.probability) || 0)),
      rationale: e.rationale || "",
      evidence: Array.isArray(e.evidence) ? e.evidence : undefined,
      sourceCount: typeof e.sourceCount === "number" ? e.sourceCount : undefined,
      timeWindow,
      category: e.category || scan.topics[i]?.category || "其他",
      financeTradeImpact: e.financeTradeImpact && (e.financeTradeImpact.positive || e.financeTradeImpact.negative)
        ? { positive: e.financeTradeImpact.positive, negative: e.financeTradeImpact.negative }
        : undefined,
      eventType: e.eventType === "ongoing" || e.eventType === "emerging" ? e.eventType : (scan.topics[i]?.type as "ongoing" | "emerging") ?? undefined,
      parentTopic: e.parentTopic?.trim() || scan.topics[i]?.parentTopic || undefined,
    });
  }

  // Build timeline from posts referenced in events
  const timeline = buildTimelineFromEvents(events, posts);

  const summary: BlackSwanSummary = {
    updatedAt: now,
    timeWindow,
    events,
  };

  const metrics: DashboardMetrics = {
    updatedAt: now,
    timeline,
    riskLevel: scan.riskLevel,
  };

  return { summary, metrics };
}

function buildTimelineFromEvents(events: BlackSwanEvent[], posts: XPost[]) {
  const refSet = new Set<number>();
  for (const ev of events) {
    if (ev.evidence) {
      for (const e of ev.evidence) {
        const n = parseInt(e.ref, 10);
        if (!isNaN(n)) refSet.add(n);
      }
    }
  }
  const nodes: Array<{ time: string; label: string; type: string; ref?: string }> = [];
  for (const ref of [...refSet].sort((a, b) => a - b).slice(0, 10)) {
    const p = posts[ref - 1];
    if (!p?.publishedAt) continue;
    nodes.push({
      time: p.publishedAt,
      label: truncateContent(p.content),
      type: "source",
      ref: String(ref),
    });
  }
  if (nodes.length === 0 && posts.length > 0) {
    const sorted = [...posts]
      .filter((p) => p.publishedAt)
      .sort((a, b) => new Date(a.publishedAt!).getTime() - new Date(b.publishedAt!).getTime())
      .slice(-6);
    for (const p of sorted) {
      nodes.push({
        time: p.publishedAt!,
        label: truncateContent(p.content),
        type: "source",
      });
    }
  }
  return nodes;
}
