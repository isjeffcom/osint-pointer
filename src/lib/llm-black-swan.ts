import type {
  BlackSwanEvent,
  BlackSwanSummary,
  DashboardMetrics,
  XPost,
} from "@/lib/types";

const MINIMAX_BASE_URL = "https://api.minimax.io";
const MINIMAX_CHAT_PATH = "/v1/text/chatcompletion_v2";
const MINIMAX_DEFAULT_MODEL = "MiniMax-M2.5";

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

const MAX_CONTEXT_POSTS = 140;

/** 按日分组并采样，保证 3 天均有代表、总条数不超 MAX_CONTEXT_POSTS。返回的数组顺序即送 LLM 的 [1][2]… 编号，供 API 作为 osintPosts 返回以便证据 ref 对应。 */
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

/** 将已按 samplePostsForContext 排序的列表格式化为送 LLM 的文本（编号与列表下标一致） */
function buildOSINTContext(orderedPosts: XPost[]): string {
  if (orderedPosts.length === 0) {
    return "（当前无 OSINT 条目，请基于「无新信号」给出低概率或「暂无显著黑天鹅」的结论。）";
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
    out += `[${i + 1}] ${time} @${p.author}: ${p.content}\n`;
  });
  return out.trim();
}

const SYSTEM_PROMPT = `你是一个 OSINT 情报简报员。用户会提供**近 3 天内**按日分组的 OSINT 条目。请识别**连贯性**：同一议题（如俄乌战争、以哈冲突、某国政策）的多条报道应合并为一条「持续事件」，并给出最新进展；真正新出现的议题标为「新兴事件」。每个结论必须**具体**（哪里、什么事件、前因后果），并列出**分析结果来源**（引用条目编号与原文片段）。

**重要**：必须根据信源具体写出国家/地区与事件类型，不得用「某战略地点」「无新信号」等笼统表述。仅当输入真的没有任何相关条目时，才输出一条「暂无显著黑天鹅」类的低概率结论。

## 输出要求

1. **事件列表 events**（至少 5 个、最多 10 个），每条必须包含：
   - title: 具体事件标题（含地点或主体）
   - location: 具体地区/国家/机构
   - causeEffect: 一两句话简述前因后果或最新进展
   - probability: 0~1 之间的发生概率（置信度）
   - rationale: 分析依据概括
   - category: 地缘、政策、市场、灾害、其他 之一
   - **eventType**: "ongoing"（持续事件，如俄乌冲突、中东局势）或 "emerging"（新兴/新爆发的单一事件）
   - **parentTopic**: 仅当 eventType 为 "ongoing" 时必填，填写该持续事件的主题，如「俄乌冲突」「中东局势」「美联储政策」
   - sourceCount: 支撑该结论的 OSINT 条数（整数）
   - evidence: 数组，每条为 { "ref": "条目编号", "quote": "原文片段或摘要" }，至少 1 条、最多 5 条
   - **financeTradeImpact**（必填）：该事件对全球金融与贸易的影响。对象包含 positive（正面/机会）、negative（负面/风险）各一两句。

2. **riskLevel**: low、medium、high、critical 之一。

3. **timeline**: 3~10 条时间线节点，每条含 time（ISO8601）、label（具体描述）、type（source/cross/trend）、ref（可选）。

请只输出一个合法 JSON，不要 markdown 代码块或其它文字。格式示例：
{
  "events": [
    {
      "title": "乌克兰东部某市交火升级",
      "location": "顿涅茨克州",
      "causeEffect": "连日炮击后双方在 X 市郊交火，可能触发更大规模动员。",
      "probability": 0.28,
      "rationale": "多源提及该市名与交火，尚未见官方确认。",
      "category": "地缘",
      "eventType": "ongoing",
      "parentTopic": "俄乌冲突",
      "sourceCount": 3,
      "financeTradeImpact": { "positive": "避险资产短期获支撑", "negative": "欧洲天然气与供应链再承压" },
      "evidence": [{ "ref": "1", "quote": "Breaking: explosions near X" }, { "ref": "2", "quote": "当地信源称交火持续" }]
    },
    {
      "title": "某国央行意外加息",
      "location": "某国",
      "causeEffect": "为应对通胀首次超预期加息。",
      "probability": 0.15,
      "rationale": "单源报道，待验证。",
      "category": "政策",
      "eventType": "emerging",
      "sourceCount": 1,
      "financeTradeImpact": { "positive": "本币短期走强", "negative": "新兴市场资金外流风险" },
      "evidence": [{ "ref": "5", "quote": "Central bank raises rate" }]
    }
  ],
  "riskLevel": "medium",
  "timeline": [
    { "time": "2026-03-15T08:00:00.000Z", "label": "路透报道某地爆炸", "type": "source", "ref": "1" }
  ]
}`;

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

/** 从 LLM 输出中提取第一个完整 JSON 对象（按括号匹配），避免尾部说明文字导致 parse 报错 */
function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error("LLM 未返回有效 JSON");
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = "";
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  throw new Error("LLM 返回的 JSON 不完整（括号未闭合）");
}

function extractJSON(text: string): LLMAnalysisResult {
  const jsonStr = extractFirstJsonObject(text);
  const parsed = JSON.parse(jsonStr) as LLMAnalysisResult;
  if (!Array.isArray(parsed.events)) parsed.events = [];
  if (!parsed.riskLevel) parsed.riskLevel = "medium";
  if (!Array.isArray(parsed.timeline)) parsed.timeline = [];
  return parsed;
}

export async function analyzeBlackSwanWithLLM(
  posts: XPost[],
  timeWindow: string = "近 30 分钟",
  ongoingContext?: string
): Promise<{ summary: BlackSwanSummary; metrics: DashboardMetrics }> {
  const { apiKey, baseUrl, model } = getLLMConfig();
  if (!apiKey) {
    throw new Error(
      "未配置 MINIMAX_API_KEY 或 LLM_API_KEY，请在环境变量中设置"
    );
  }

  const context = buildOSINTContext(posts);
  const ongoingBlock = ongoingContext?.trim()
    ? `\n以下为近期持续事件（供参考，可据此判断是否仍为持续事件）：\n${ongoingContext}\n\n`
    : "";
  const userPrompt = `${ongoingBlock}以下为「${timeWindow}」内按日分组的 OSINT 条目（编号即 ref，格式：时间 @作者 内容）。请识别持续事件与新兴事件，输出至少 5 个、最多 10 个事件的简报式结论与证据来源 JSON。\n\n${context}`;

  const useMinimax = isMinimax(baseUrl);
  const url = useMinimax
    ? `${baseUrl.replace(/\/$/, "")}${MINIMAX_CHAT_PATH}`
    : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
  };
  if (useMinimax) {
    body.max_tokens = 8192;
  } else if (baseUrl.includes("openai.com")) {
    body.response_format = { type: "json_object" };
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
    throw new Error(`LLM 请求失败 ${res.status}: ${err.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
    }>;
    base_resp?: { status_code?: number; status_msg?: string };
  };

  if (data.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0) {
    throw new Error(
      data.base_resp.status_msg || `MiniMax 返回错误码 ${data.base_resp.status_code}`
    );
  }

  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!content) throw new Error("LLM 未返回内容");

  const analyzed = extractJSON(content);
  const now = new Date().toISOString();

  const events: BlackSwanEvent[] = analyzed.events.slice(0, 10).map((e, i) => ({
    id: `bs-${i + 1}`,
    title: e.title || "未命名事件",
    location: e.location,
    causeEffect: e.causeEffect,
    probability: Math.max(0, Math.min(1, Number(e.probability) || 0)),
    rationale: e.rationale || "",
    evidence: Array.isArray(e.evidence) ? e.evidence : undefined,
    sourceCount: typeof e.sourceCount === "number" ? e.sourceCount : undefined,
    timeWindow,
    category: e.category || "其他",
    financeTradeImpact: e.financeTradeImpact && (e.financeTradeImpact.positive || e.financeTradeImpact.negative)
      ? { positive: e.financeTradeImpact.positive, negative: e.financeTradeImpact.negative }
      : undefined,
    eventType: e.eventType === "ongoing" || e.eventType === "emerging" ? e.eventType : undefined,
    parentTopic: e.parentTopic?.trim() || undefined,
  }));

  const summary: BlackSwanSummary = {
    updatedAt: now,
    timeWindow,
    events,
  };

  const metrics: DashboardMetrics = {
    updatedAt: now,
    timeline: analyzed.timeline
      .filter((t) => t.label && t.label.trim())
      .map((t) => ({
        time: t.time || now,
        label: t.label.trim(),
        type: t.type || "source",
        ref: t.ref,
      })),
    riskLevel: analyzed.riskLevel,
  };

  return { summary, metrics };
}
