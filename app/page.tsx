"use client";

import { Button, Card, CardBody, Chip, Input, Spinner } from "@heroui/react";
import { useMemo, useState } from "react";
import { type DashboardResponse } from "@/lib/types";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);

  const sourceMessage = useMemo(() => {
    if (!data) return "";
    return data.sourceMode === "rss" ? "数据来源：Nitter RSS" : "数据来源：Mock fallback（RSS 不可用）";
  }, [data]);

  async function analyze() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/analyze?query=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: DashboardResponse = await response.json();
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 40px" }}>
      <h1 style={{ marginBottom: 6 }}>OSINT Multi-Agent Confidence Dashboard</h1>
      <p style={{ color: "#94a3b8", marginTop: 0 }}>
        不是仅展示信息，而是通过多智能体给出 claim 置信度判断（参考 pizzint.watch / MiroFish）。
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Input
          value={query}
          onValueChange={setQuery}
          placeholder="输入关键词，例如：taiwan strait incident"
          variant="bordered"
        />
        <Button color="primary" onPress={analyze} isDisabled={loading || !query.trim()}>
          抓取 X 并分析
        </Button>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8" }}>
          <Spinner size="sm" /> 正在抓取与分析...
        </div>
      )}

      {error && <p style={{ color: "#ef4444" }}>请求失败：{error}</p>}

      {data && (
        <>
          <p style={{ color: "#94a3b8" }}>
            命中 {data.posts.length} 条结果。{sourceMessage}
            <br />
            分析时间：{new Date(data.meta.analyzedAt).toLocaleString()} · 执行模式：{data.meta.execution}{data.meta.workerRegion ? ` · 边缘区域: ${data.meta.workerRegion}` : ""}
          </p>
          <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {data.assessments.map((assessment, idx) => (
              <Card key={`${assessment.claim}-${idx}`} className="bg-slate-900/60 border border-slate-700">
                <CardBody>
                  <p style={{ marginTop: 0, color: "#cbd5e1" }}>Claim #{idx + 1}</p>
                  <p>{assessment.claim}</p>
                  <p style={{ fontWeight: 700, marginBottom: 8 }}>置信度：{(assessment.confidence * 100).toFixed(1)}%</p>
                  <Chip
                    color={assessment.confidence >= 0.75 ? "success" : assessment.confidence >= 0.5 ? "warning" : "danger"}
                    variant="flat"
                  >
                    {assessment.verdict}
                  </Chip>
                  <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 13 }}>
                    {assessment.signals.map((signal) => (
                      <p key={signal.name} style={{ margin: "4px 0" }}>
                        • <b>{signal.name}</b> ({signal.score.toFixed(2)}): {signal.rationale}
                      </p>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
