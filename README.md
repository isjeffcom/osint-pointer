# osint-pointer

基于 **Next.js + React + TypeScript + HeroUI** 的 OSINT dashboard。

目标不是“只展示信息”，而是通过 multi-agent 对 X 上的 claim 计算置信度与判决标签。

## 技术栈（现代前端）

- Next.js 14 (App Router)
- React 18 + TypeScript
- HeroUI（UI 组件）
- Edge Runtime API (`app/api/analyze/route.ts`)

## 能力概览

- 输入关键词，抓取 X 相关公开信息（通过 Nitter RSS）
- RSS 不可用时自动 fallback 到 mock 数据（保障持续演示）
- 4 个分析 Agent：
  - `source_reputation`
  - `content_evidence`
  - `temporal_consistency`
  - `cross_post_consensus`
- 聚合输出 verdict：
  - `Likely credible`
  - `Needs corroboration`
  - `Low confidence`

## 本地开发

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 测试与检查

```bash
npm run typecheck
npm run test
npm run lint
```

## Cloudflare Workers 部署（单实例持续运行）

这个项目可以部署到 Cloudflare Workers，作为一个 **单服务实例** 持续运行（不需要多节点协调）。

### 推荐构建方法（对齐现代分析工具的部署路径）

不少现代信息分析产品会采用：
1. 前端与 API 同仓（Next.js）
2. 边缘运行（Workers）
3. 无状态计算 + 外部可选存储

本项目使用 `@opennextjs/cloudflare`：

```bash
npm install
npm run build:worker
npm run deploy:worker
```

关键文件：
- `open-next.config.ts`
- `wrangler.toml`
- `app/api/analyze/route.ts`（`runtime = "edge"`）

## 未来可扩展

- 接入更多源（Reddit / Telegram / 新闻 API）
- Agent debate / critic 机制
- 证据图谱与时间线追踪
- 持久化（D1 / KV / R2）用于历史追踪
