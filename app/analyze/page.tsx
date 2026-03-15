"use client";

import { Button, Card, CardBody, Chip, Input, Spinner } from "@heroui/react";
import { useMemo, useState } from "react";
import { type DashboardResponse } from "@/lib/types";

export default function AnalyzePage() {
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
    <main className="min-h-screen bg-[#0b1020] text-slate-200 p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <p className="text-slate-500 text-sm mb-4">
          <a href="/" className="text-sky-400 hover:underline">← 返回首页</a>（黑天鹅 + Dashboard）
        </p>
        <h1 className="text-xl font-bold text-white mb-2">按关键词分析单条推文可信度</h1>
        <p className="text-slate-400 text-sm mb-6">
          规则引擎：无需 API Key；对抓取到的每条推文做多维度打分并给出 verdict。
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <Input
            value={query}
            onValueChange={setQuery}
            placeholder="输入关键词，例如：taiwan strait incident"
            variant="bordered"
            className="max-w-sm"
          />
          <Button color="primary" onPress={analyze} isDisabled={loading || !query.trim()}>
            抓取 X 并分析
          </Button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-slate-400 mb-4">
            <Spinner size="sm" /> 正在抓取与分析…
          </div>
        )}
        {error && <p className="text-red-400 mb-4">请求失败：{error}</p>}

        {data && (
          <>
            <p className="text-slate-400 text-sm mb-4">
              命中 {data.posts.length} 条结果。{sourceMessage}
              {data.meta && (
                <>
                  <br />
                  分析时间：{new Date(data.meta.analyzedAt).toLocaleString()} · 执行模式：{data.meta.execution}
                  {data.meta.workerRegion ? ` · 边缘区域: ${data.meta.workerRegion}` : ""}
                </>
              )}
            </p>
            <section className="grid gap-4 sm:grid-cols-2">
              {data.assessments.map((assessment, idx) => (
                <Card key={`${assessment.claim}-${idx}`} className="bg-slate-900/60 border border-slate-700">
                  <CardBody>
                    <p className="text-slate-400 text-sm mt-0 mb-1">Claim #{idx + 1}</p>
                    <p className="mb-2">{assessment.claim}</p>
                    <p className="font-semibold mb-2">置信度：{(assessment.confidence * 100).toFixed(1)}%</p>
                    <Chip
                      color={assessment.confidence >= 0.75 ? "success" : assessment.confidence >= 0.5 ? "warning" : "danger"}
                      variant="flat"
                      className="mb-2"
                    >
                      {assessment.verdict}
                    </Chip>
                    <div className="text-slate-400 text-sm space-y-1">
                      {assessment.signals.map((signal) => (
                        <p key={signal.name}>
                          · <b>{signal.name}</b> ({signal.score.toFixed(2)}): {signal.rationale}
                        </p>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
