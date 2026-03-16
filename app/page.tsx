"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Progress,
  Spinner,
} from "@heroui/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { useEffect, useState } from "react";
import type {
  BlackSwanEvent,
  BlackSwanSummary,
  DashboardMetrics,
  EventEvidence,
} from "@/lib/types";
import type { XPost } from "@/lib/types";

type BlackSwanApiMeta = {
  sourceMode?: string;
  osintCount?: number;
  fetchedAt?: string;
  windowLabel?: string;
};

function applyApiData(
  data: Record<string, unknown>,
  setSummary: (v: BlackSwanSummary | null) => void,
  setMetrics: (v: DashboardMetrics | null) => void,
  setMeta: (v: BlackSwanApiMeta | null) => void,
  setOsintPosts: (v: XPost[]) => void,
  setPartialMessage: (v: string | null) => void
) {
  setPartialMessage(data.partial === true && typeof data.partialMessage === "string" ? data.partialMessage : null);
  setSummary((data.summary ?? null) as BlackSwanSummary | null);
  setMetrics((data.metrics ?? null) as DashboardMetrics | null);
  setMeta((data.meta ?? null) as BlackSwanApiMeta | null);
  setOsintPosts(Array.isArray(data.osintPosts) ? (data.osintPosts as XPost[]) : []);
}

function useBlackSwanData() {
  const [summary, setSummary] = useState<BlackSwanSummary | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [meta, setMeta] = useState<BlackSwanApiMeta | null>(null);
  const [osintPosts, setOsintPosts] = useState<XPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [partialMessage, setPartialMessage] = useState<string | null>(null);
  const [needsTrigger, setNeedsTrigger] = useState(false);

  const runCollectAndAnalyze = () => {
    setError("");
    setErrorCode(null);
    setNeedsTrigger(false);
    setLoading(true);
    fetch("/api/black-swan")
      .then(async (r) => {
        let data: Record<string, unknown> = {};
        try {
          const text = await r.text();
          data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          setError("接口返回异常，请重试");
          return;
        }
        if (!r.ok) {
          if (r.status === 503 && data.error === "MISSING_LLM_API_KEY") {
            setErrorCode("MISSING_LLM_API_KEY");
            setError((data.message as string) || "请配置 MINIMAX_API_KEY 或 LLM_API_KEY");
          } else if (r.status === 503 && data.error === "NO_OSINT_DATA") {
            setErrorCode("NO_OSINT_DATA");
            setError((data.message as string) || "当前无法从 OSINT 信源拉取到数据，请稍后重试。");
          } else {
            setError((data.message as string) || `HTTP ${r.status}`);
          }
          return;
        }
        applyApiData(data, setSummary, setMetrics, setMeta, setOsintPosts, setPartialMessage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/black-swan?onlyCache=1")
      .then(async (r) => {
        let data: Record<string, unknown> = {};
        try {
          const text = await r.text();
          data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          if (!r.ok) setError("接口返回异常，请重试");
          else setError("接口返回数据解析失败（可能含非法字符），请重试");
          return;
        }
        if (!r.ok) {
          if (!cancelled) {
            if (r.status === 503 && data.error === "MISSING_LLM_API_KEY") {
              setErrorCode("MISSING_LLM_API_KEY");
              setError((data.message as string) || "请配置 MINIMAX_API_KEY 或 LLM_API_KEY");
            } else if (r.status === 503 && data.error === "NO_OSINT_DATA") {
              setErrorCode("NO_OSINT_DATA");
              setError((data.message as string) || "当前无法从 OSINT 信源拉取到数据，请稍后重试。");
            } else {
              setError((data.message as string) || `HTTP ${r.status}`);
            }
          }
          return;
        }
        if (cancelled) return;
        if (data.cached === false || !data.summary) {
          setNeedsTrigger(true);
        } else {
          applyApiData(data, setSummary, setMetrics, setMeta, setOsintPosts, setPartialMessage);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return { summary, metrics, meta, osintPosts, loading, error, errorCode, partialMessage, needsTrigger, runCollectAndAnalyze };
}

function RiskBadge({ level }: { level: DashboardMetrics["riskLevel"] }) {
  if (!level) return null;
  const color = level === "critical" ? "danger" : level === "high" ? "danger" : level === "medium" ? "warning" : "success";
  const label = { low: "低", medium: "中", high: "高", critical: "极高" }[level];
  return <Chip color={color} variant="flat">{label}风险</Chip>;
}

/** 归因节点图：左侧事件节点，右侧证据节点，中间连线 */
function EventEvidenceNodeGraph({ events }: { events: BlackSwanEvent[] }) {
  const eventNodes = events.filter((e) => (e.evidence?.length ?? 0) > 0);
  if (eventNodes.length === 0) return <p className="text-slate-500 text-sm">暂无结论-证据数据</p>;

  const leftX = 20;
  const rightX = 300;
  const nodeWidth = 180;
  const nodeHeight = 40;
  const gap = 16;
  const leftNodes: { x: number; y: number; title: string }[] = [];
  const rightNodes: { x: number; y: number; quote: string; eventIdx: number }[] = [];
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];

  let leftY = 24;
  eventNodes.forEach((evt, idx) => {
    leftNodes.push({ x: leftX, y: leftY, title: evt.title.slice(0, 18) + (evt.title.length > 18 ? "…" : "") });
    const leftCy = leftY + nodeHeight / 2;
    (evt.evidence ?? []).forEach((ev) => {
      const rY = 24 + rightNodes.length * (nodeHeight + gap);
      rightNodes.push({
        x: rightX, y: rY, quote: ev.quote.slice(0, 36) + (ev.quote.length > 36 ? "…" : ""), eventIdx: idx,
      });
      edges.push({
        x1: leftX + nodeWidth, y1: leftCy,
        x2: rightX, y2: rY + nodeHeight / 2,
      });
    });
    leftY += nodeHeight + gap;
  });

  const height = Math.max(200, Math.max(leftY, 24 + rightNodes.length * (nodeHeight + gap)) + 24);
  const width = 520;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {edges.map((e, i) => (
        <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#475569" strokeWidth={1.5} strokeDasharray="4 3" />
      ))}
      {leftNodes.map((n, i) => (
        <g key={`l-${i}`}>
          <rect x={n.x} y={n.y} width={nodeWidth} height={nodeHeight} rx={6} fill="#0f172a" stroke="#06b6d4" strokeWidth={1.5} />
          <text x={n.x + 10} y={n.y + nodeHeight / 2 + 4} fill="#e2e8f0" fontSize={11}>{n.title}</text>
        </g>
      ))}
      {rightNodes.map((n, i) => (
        <g key={`r-${i}`}>
          <rect x={n.x} y={n.y} width={nodeWidth} height={nodeHeight} rx={6} fill="#1e293b" stroke="#f59e0b" strokeWidth={1} />
          <text x={n.x + 8} y={n.y + nodeHeight / 2 + 3} fill="#94a3b8" fontSize={9}>{n.quote}</text>
        </g>
      ))}
    </svg>
  );
}

/** 根据 evidence.ref 解析为 OSINT 条目序号（1-based），用于关联 osintPosts */
function refToIndex(ref: string): number {
  const n = parseInt(ref.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : Math.max(1, n);
}

const RISK_WEIGHT: Record<NonNullable<DashboardMetrics["riskLevel"]>, number> = {
  low: 20,
  medium: 45,
  high: 72,
  critical: 95,
};

/** 黑天鹅指数 0–100：综合风险等级、平均概率、事件数量 */
function computeBlackSwanIndex(
  riskLevel: DashboardMetrics["riskLevel"],
  avgProb: number,
  eventCount: number
): number {
  const base = RISK_WEIGHT[riskLevel ?? "medium"] ?? 45;
  const probPart = Math.round(avgProb * 100) * 0.35;
  const countPart = Math.min(eventCount * 8, 25);
  return Math.min(100, Math.round(base * 0.4 + probPart + countPart));
}

/** 地缘政治风险指数 0–100：风险等级 + 地缘类事件加权 */
function computeGeoRiskIndex(
  riskLevel: DashboardMetrics["riskLevel"],
  events: BlackSwanEvent[]
): number {
  const base = RISK_WEIGHT[riskLevel ?? "medium"] ?? 45;
  const geoCount = events.filter((e) => e.category === "地缘").length;
  const geoBonus = Math.min(geoCount * 12, 35);
  return Math.min(100, Math.round(base + geoBonus));
}

const INDEX_ACCENT_STYLES = {
  amber: { bg: "from-amber-500/10 to-transparent", border: "border-amber-500/30", text: "text-amber-400" },
  rose: { bg: "from-rose-500/10 to-transparent", border: "border-rose-500/30", text: "text-rose-400" },
  cyan: { bg: "from-cyan-500/10 to-transparent", border: "border-cyan-500/30", text: "text-cyan-400" },
  danger: { bg: "from-red-500/15 to-transparent", border: "border-red-500/40", text: "text-red-400" },
  warning: { bg: "from-orange-500/10 to-transparent", border: "border-orange-500/30", text: "text-orange-400" },
  success: { bg: "from-emerald-500/10 to-transparent", border: "border-emerald-500/30", text: "text-emerald-400" },
} as const;

/** 指数展示卡片（PizzINT 风格），支持描述性语句与按风险着色 */
function IndexCard({
  label,
  value,
  sublabel,
  description,
  accent,
}: {
  label: string;
  value: number | string;
  sublabel?: string;
  /** 描述性语句，如「极高」「正在发生」 */
  description?: string;
  accent: keyof typeof INDEX_ACCENT_STYLES;
}) {
  const style = INDEX_ACCENT_STYLES[accent] ?? INDEX_ACCENT_STYLES.cyan;
  return (
    <div className={`rounded-2xl border ${style.border} bg-gradient-to-br ${style.bg} backdrop-blur-sm p-5 min-w-[140px] flex-1 shadow-lg shadow-black/10`}>
      <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <p className={`text-3xl md:text-4xl font-bold tabular-nums ${style.text}`}>{value}</p>
        {description && <span className={`text-sm font-medium ${style.text} opacity-90`}>{description}</span>}
      </div>
      {sublabel && <p className="text-slate-500 text-xs mt-1">{sublabel}</p>}
    </div>
  );
}

/** 黑天鹅指数数值 → 描述性语句 */
function blackSwanIndexDescription(n: number): string {
  if (n >= 90) return "极高";
  if (n >= 70) return "高";
  if (n >= 50) return "中";
  return "低";
}

/** 地缘政治风险指数数值 → 描述性语句 */
function geoRiskIndexDescription(n: number): string {
  if (n >= 90) return "正在发生";
  if (n >= 70) return "高";
  if (n >= 50) return "中";
  return "低";
}

/** 综合风险等级 → 卡片 accent（注意颜色） */
function riskLevelAccent(level: DashboardMetrics["riskLevel"]): keyof typeof INDEX_ACCENT_STYLES {
  if (level === "critical") return "danger";
  if (level === "high") return "warning";
  if (level === "medium") return "amber";
  return "success";
}

/** 信源跑马灯：展示 OSINT 条目，无缝横向滚动 */
function OsintTicker({ posts }: { posts: XPost[] }) {
  if (posts.length === 0) return null;
  const items = posts.slice(0, 30).map((p) => ({
    id: p.id,
    author: p.author,
    text: p.content.slice(0, 120) + (p.content.length > 120 ? "…" : ""),
    link: p.link,
  }));
  const duplicated = [...items, ...items];
  return (
    <div className="w-full overflow-hidden rounded-xl bg-slate-800/50 border border-slate-700/80 py-3 backdrop-blur-sm">
      <p className="text-slate-500 text-xs px-4 mb-2 uppercase tracking-wider">信源动态 · 点击跳转原文</p>
      <div className="relative">
        <div className="osint-ticker-track">
          {duplicated.map((item, i) => (
            <a
              key={`${item.id}-${i}`}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 mx-3 px-4 py-2.5 rounded-lg bg-slate-800/90 border border-slate-600/50 hover:border-cyan-500/40 hover:bg-slate-700/80 transition-colors min-w-[300px] max-w-[360px]"
            >
              <span className="text-cyan-400 font-medium shrink-0">@{item.author}</span>
              <span className="text-slate-300 text-sm line-clamp-1">{item.text}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { summary, metrics, meta, osintPosts, loading, error, errorCode, partialMessage, needsTrigger, runCollectAndAnalyze } = useBlackSwanData();

  const probabilityChartData = summary?.events.map((e) => ({
    name: e.title.length > 12 ? e.title.slice(0, 12) + "…" : e.title,
    fullName: e.title,
    概率: Math.round(e.probability * 100),
  })) ?? [];

  const sourceDistData = metrics?.sourceDistribution
    ? Object.entries(metrics.sourceDistribution).map(([name, count]) => ({ name, 条数: count }))
    : [];

  const riskToNumber = (level: DashboardMetrics["riskLevel"]) =>
    ({ low: 25, medium: 50, high: 75, critical: 100 }[level ?? "medium"] ?? 50);
  const avgProb = summary?.events.length
    ? summary.events.reduce((a, e) => a + e.probability, 0) / summary.events.length
    : 0;
  const radarData = summary && meta
    ? [
        { subject: "地缘风险", value: riskToNumber(metrics?.riskLevel), fullMark: 100 },
        { subject: "市场波动", value: Math.round(avgProb * 100), fullMark: 100 },
        { subject: "贸易影响", value: Math.round(avgProb * 90), fullMark: 100 },
        { subject: "信源覆盖", value: Math.min(100, (meta.osintCount ?? 0) * 2), fullMark: 100 },
        { subject: "事件数量", value: Math.min(100, summary.events.length * 25), fullMark: 100 },
      ]
    : [];

  const COLORS = ["#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e"];

  const blackSwanIndex = summary && metrics
    ? computeBlackSwanIndex(metrics.riskLevel, avgProb, summary.events.length)
    : null;
  const geoRiskIndex = summary && metrics
    ? computeGeoRiskIndex(metrics.riskLevel, summary.events)
    : null;

  return (
    <main className="min-h-screen bg-[#0a0f1a] text-slate-200">
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent pointer-events-none" aria-hidden />
      <div className="max-w-[90rem] mx-auto relative px-4 sm:px-6 lg:px-8 py-6 md:py-10 space-y-8">
        {/* 首屏：标题 + 指数 + 跑马灯 */}
        {partialMessage && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-amber-200 text-sm">
            本次 LLM 分析未完成，仅展示信源动态与时间线：{partialMessage}
          </div>
        )}
        <header className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight">
                OSINT 黑天鹅指针
              </h1>
              <p className="text-slate-400 mt-2 text-sm sm:text-base max-w-xl">
                近 6 小时多源 OSINT 拉取 + LLM 简报分析（建议每 30 分钟更新）· 结论先行，证据可追溯
              </p>
            </div>
            {meta && (
              <p className="text-slate-500 text-xs md:text-sm shrink-0">
                {meta.windowLabel} · {meta.osintCount ?? 0} 条信源
                {meta.fetchedAt && (
                  <> · {new Date(meta.fetchedAt).toLocaleTimeString("zh-CN")}</>
                )}
              </p>
            )}
          </div>

          {/* 指数卡片行（黑天鹅指数 + 地缘政治风险指数 + 综合风险，带描述性语句与颜色） */}
          <div className="flex flex-wrap gap-4 sm:gap-5">
            <IndexCard
              label="黑天鹅指数"
              value={loading ? "—" : (blackSwanIndex ?? "—")}
              description={typeof blackSwanIndex === "number" ? blackSwanIndexDescription(blackSwanIndex) : undefined}
              sublabel={summary ? "综合事件概率与风险等级" : undefined}
              accent="amber"
            />
            <IndexCard
              label="地缘政治风险指数"
              value={loading ? "—" : (geoRiskIndex ?? "—")}
              description={typeof geoRiskIndex === "number" ? geoRiskIndexDescription(geoRiskIndex) : undefined}
              sublabel={summary ? "地缘类事件加权" : undefined}
              accent="rose"
            />
            {summary && (
              <IndexCard
                label="综合风险"
                value={
                  metrics?.riskLevel === "critical"
                    ? "极高"
                    : metrics?.riskLevel === "high"
                      ? "高"
                      : metrics?.riskLevel === "medium"
                        ? "中"
                        : "低"
                }
                sublabel="当前评估"
                accent={riskLevelAccent(metrics?.riskLevel)}
              />
            )}
          </div>

          {/* 信源跑马灯 */}
          {osintPosts.length > 0 && <OsintTicker posts={osintPosts} />}
        </header>

        {loading && (
          <div className="rounded-xl border border-slate-600/80 bg-slate-800/60 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-6 space-y-4">
              <div className="flex items-center gap-3 text-slate-300">
                <Spinner size="md" classNames={{ circle1: "border-b-cyan-400", circle2: "border-b-cyan-500" }} />
                <div>
                  <p className="font-medium text-white">正在拉取近 6 小时 OSINT 并调用 LLM 分析</p>
                  <p className="text-sm text-slate-500 mt-0.5">预计 30 秒–2 分钟，请耐心等待</p>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 animate-[loading-bar_2s_ease-in-out_infinite]"
                  style={{ width: "40%" }}
                />
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400/80 animate-pulse" />
                多信源并行拉取 → 采样送 LLM → 生成简报与归因
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-900/20 border border-red-800 p-4 text-red-300">
            {errorCode === "MISSING_LLM_API_KEY" ? (
              <p>请在项目根目录配置 <code className="bg-slate-800 px-1 rounded">.env</code>：<code className="bg-slate-800 px-1 rounded">MINIMAX_API_KEY=你的密钥</code>（<a href="https://platform.minimax.io" target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">platform.minimax.io</a>），然后重启开发服务器。</p>
            ) : errorCode === "NO_OSINT_DATA" ? (
              <p>后端未能从配置的 OSINT 账号拉取到数据（Nitter 可能暂时不可用）。请稍后刷新重试。</p>
            ) : (
              <p>加载失败：{error}</p>
            )}
          </div>
        )}

        {!loading && !error && needsTrigger && (
          <div className="rounded-xl border border-slate-600/80 bg-slate-800/60 backdrop-blur-sm p-8 flex flex-col items-center justify-center gap-4 text-center">
            <p className="text-slate-300">近 30 分钟内暂无缓存数据，点击下方按钮开始拉取近 6 小时 OSINT 并进行 LLM 分析。</p>
            <Button color="primary" size="lg" onPress={runCollectAndAnalyze} className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium">
              开始收集并分析
            </Button>
          </div>
        )}

        {!loading && !error && !needsTrigger && summary && (
          <>
            {/* 一、结论与证据（简报式 + 展开证据） */}
            <section>
              <h2 className="text-lg font-semibold text-white mb-2">
                结论：近期最可能发生的黑天鹅事件（{summary.timeWindow}）
              </h2>
              <p className="text-slate-500 text-sm mb-4">
                更新于 {new Date(summary.updatedAt).toLocaleString()}
                {meta && <> · 数据来源：{meta.windowLabel ?? "近6小时"} OSINT（{meta.osintCount ?? 0} 条）+ LLM 分析</>}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                {summary.events.map((event: BlackSwanEvent, idx: number) => (
                  <Card key={event.id} className="bg-slate-900/80 border border-slate-700 overflow-hidden">
                    <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Chip size="sm" variant="flat" className="text-slate-200 bg-slate-700/80">{event.category ?? "未分类"}</Chip>
                        {event.eventType && (
                          <Chip size="sm" variant="flat" color={event.eventType === "ongoing" ? "secondary" : "default"}>
                            {event.eventType === "ongoing" ? "持续" : "新兴"}
                          </Chip>
                        )}
                        {event.parentTopic && (
                          <span className="text-xs text-cyan-400/90">#{event.parentTopic}</span>
                        )}
                        {event.location && (
                          <span className="text-sm text-amber-400/90">📍 {event.location}</span>
                        )}
                        <Chip
                          size="sm"
                          variant="flat"
                          color={event.probability >= 0.6 ? "success" : event.probability >= 0.3 ? "warning" : "default"}
                        >
                          {(event.probability * 100).toFixed(0)}% 置信度
                        </Chip>
                      </div>
                    </CardHeader>
                    <CardBody className="pt-0 space-y-2">
                      <h3 className="font-medium text-white">{event.title}</h3>
                      {event.causeEffect && (
                        <p className="text-slate-300 text-sm">前因后果：{event.causeEffect}</p>
                      )}
                      <p className="text-slate-400 text-sm">{event.rationale}</p>
                      {/* 金融与贸易影响（正反建议） */}
                      {event.financeTradeImpact && (event.financeTradeImpact.positive || event.financeTradeImpact.negative) && (
                        <div className="rounded-lg bg-slate-800/60 border border-slate-600 p-3 space-y-2 text-sm">
                          <p className="text-slate-400 font-medium">全球金融与贸易影响</p>
                          {event.financeTradeImpact.positive && (
                            <p className="text-emerald-400/90">正面/机会：{event.financeTradeImpact.positive}</p>
                          )}
                          {event.financeTradeImpact.negative && (
                            <p className="text-rose-400/90">负面/风险：{event.financeTradeImpact.negative}</p>
                          )}
                        </div>
                      )}
                      <Progress
                        value={event.probability * 100}
                        color={event.probability >= 0.3 ? "warning" : "primary"}
                        size="sm"
                        className="max-w-full"
                      />
                      {/* 展开：证据来源（树状归因）；同一事件内相同 ref 的图片只展示一次，避免重复图 */}
                      {(event.evidence?.length ?? 0) > 0 && (() => {
                        const shownImageRefs = new Set<string>();
                        return (
                          <div className="mt-4 border-t border-slate-700 pt-4">
                            <p className="text-slate-400 text-sm font-medium mb-2">📎 分析结果来源（证据）</p>
                            <ul className="space-y-3 pl-4 border-l-2 border-slate-600">
                              {event.evidence!.map((ev: EventEvidence, i: number) => {
                                const postIndex = refToIndex(ev.ref);
                                const linkedPost = postIndex > 0 && osintPosts[postIndex - 1];
                                const postWithImage = linkedPost && "imageUrl" in linkedPost && linkedPost.imageUrl;
                                const refKey = `${ev.ref}-${postIndex}`;
                                const showImage = postWithImage && !shownImageRefs.has(refKey);
                                if (showImage) shownImageRefs.add(refKey);
                                return (
                                  <li key={`${event.id}-ev-${i}-${ev.ref}`} className="text-sm">
                                    <p className="text-slate-300">{ev.quote}</p>
                                    {linkedPost && (
                                      <div className="mt-1.5 space-y-1">
                                        {showImage && (
                                          <a href={linkedPost.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-slate-600 max-w-xs">
                                            <img src={postWithImage} alt="" className="w-full h-auto max-h-48 object-cover" loading="lazy" referrerPolicy="no-referrer" />
                                          </a>
                                        )}
                                        <span className="text-slate-500">
                                          → 原文 @{linkedPost.author}: {linkedPost.content.slice(0, 80)}{linkedPost.content.length > 80 ? "…" : ""}
                                          {linkedPost.link && (
                                            <a href={linkedPost.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 ml-1 hover:underline">链接</a>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })()}
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>

            {/* 二、数据分析 Dashboard：条形图 + 时间线 + 来源分布 */}
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">数据分析 Dashboard（归因图表）</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                {/* 事件概率条形图 */}
                <Card className="bg-slate-900/80 border border-slate-700">
                  <CardHeader>
                    <span className="text-slate-300">各结论发生概率</span>
                  </CardHeader>
                  <CardBody>
                    {probabilityChartData.length > 0 ? (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={probabilityChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                            <YAxis type="category" dataKey="name" width={90} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip
                              content={({ payload }) =>
                                payload?.[0] ? (
                                  <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200">
                                    {payload[0].payload.fullName}：{payload[0].payload.概率}%
                                  </div>
                                ) : null
                              }
                            />
                            <Bar dataKey="概率" radius={[0, 4, 4, 0]}>
                              {probabilityChartData.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">暂无事件数据</p>
                    )}
                  </CardBody>
                </Card>

                {/* 来源分布条形图 */}
                <Card className="bg-slate-900/80 border border-slate-700">
                  <CardHeader>
                    <span className="text-slate-300">各渠道信号条数</span>
                  </CardHeader>
                  <CardBody>
                    {sourceDistData.length > 0 ? (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={sourceDistData} margin={{ bottom: 8 }}>
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                            <Tooltip
                              content={({ payload }) =>
                                payload?.[0] ? (
                                  <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200">
                                    {payload[0].payload.name}：{payload[0].payload.条数} 条
                                  </div>
                                ) : null
                              }
                            />
                            <Bar dataKey="条数" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">暂无来源分布</p>
                    )}
                  </CardBody>
                </Card>
              </div>

              {/* 雷达图：多维度风险与覆盖 */}
              {radarData.length > 0 && (
                <Card className="bg-slate-900/80 border border-slate-700 mt-6">
                  <CardHeader>
                    <span className="text-slate-300">多维度雷达（地缘 / 市场 / 贸易 / 信源 / 事件）</span>
                  </CardHeader>
                  <CardBody>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                          <PolarGrid stroke="#475569" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#64748b" }} />
                          <Radar name="当前" dataKey="value" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.4} />
                          <Tooltip
                            content={({ payload }) =>
                              payload?.[0] ? (
                                <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200">
                                  {payload[0].payload.subject}：{payload[0].payload.value}
                                </div>
                              ) : null
                            }
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* 时间线（带具体 label） */}
              <Card className="bg-slate-900/80 border border-slate-700 mt-6">
                <CardHeader>
                  <span className="text-slate-300">时间线（近 6 小时信号节点）</span>
                </CardHeader>
                <CardBody>
                  {metrics?.timeline?.length ? (
                    <div className="flex flex-col gap-2">
                      {metrics.timeline.map((node, i) => (
                        <div key={i} className="flex items-start gap-4 py-2 border-b border-slate-700/50 last:border-0">
                          <span className="text-slate-500 text-sm whitespace-nowrap">
                            {new Date(node.time).toLocaleTimeString("zh-CN")}
                          </span>
                          <span className="text-slate-200 text-sm flex-1">{node.label || "—"}</span>
                          <Chip size="sm" variant="flat">{node.type}</Chip>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm">暂无时间线数据</p>
                  )}
                </CardBody>
              </Card>

              {/* 综合风险 */}
              <div className="mt-4 flex items-center gap-4">
                <span className="text-slate-400 text-sm">当前综合风险</span>
                <RiskBadge level={metrics?.riskLevel} />
              </div>
            </section>

            {/* 三、树状图：结论 → 证据层级 */}
            {summary.events.some((e) => (e.evidence?.length ?? 0) > 0) && (
              <section>
                <h2 className="text-lg font-semibold text-white mb-4">树状图：结论 → 证据层级</h2>
                <Card className="bg-slate-900/80 border border-slate-700">
                  <CardBody>
                    <div className="font-medium text-amber-300 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400" /> 结论（黑天鹅事件）
                    </div>
                    <ul className="space-y-0 list-none">
                      {summary.events.map((event, idx) => (
                        <li key={event.id} className="mb-4">
                          <div className="flex items-start gap-2">
                            <span className="text-slate-500 mt-1.5">├</span>
                            <div className="rounded-lg border border-slate-600 bg-slate-800/50 p-3 flex-1 min-w-0">
                              <span className="text-amber-400/90 font-medium">事件 {idx + 1}</span>
                              <span className="text-white ml-2">{event.title}</span>
                            </div>
                          </div>
                          {(event.evidence ?? []).length > 0 && (
                            <ul className="ml-6 pl-4 border-l-2 border-slate-600 mt-2 space-y-2 list-none">
                              {(event.evidence ?? []).map((ev, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                                  <span className="text-slate-500">└</span>
                                  <span className="rounded border border-slate-700 p-2 bg-slate-800/30 flex-1">
                                    {ev.quote.slice(0, 100)}{ev.quote.length > 100 ? "…" : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              </section>
            )}

            {/* 四、归因节点图：事件 ↔ 证据连线 */}
            {summary.events.some((e) => (e.evidence?.length ?? 0) > 0) && (
              <section>
                <h2 className="text-lg font-semibold text-white mb-4">归因节点图（结论 ↔ 证据）</h2>
                <Card className="bg-slate-900/80 border border-slate-700">
                  <CardBody>
                    <div className="overflow-x-auto min-h-[280px] flex items-center justify-center py-4">
                      <EventEvidenceNodeGraph events={summary.events} />
                    </div>
                  </CardBody>
                </Card>
              </section>
            )}
          </>
        )}

      </div>
    </main>
  );
}
