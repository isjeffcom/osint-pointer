# osint-pointer

基于 **Next.js + React + TypeScript + HeroUI** 的 OSINT dashboard。

目标不是"只展示信息"，而是通过 multi-agent 对 X 上的 claim 计算置信度与判决标签。

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

### 安装依赖问题（ERESOLVE）

如果你在本地遇到 `eslint` 与 `eslint-config-next` 的 peer 依赖冲突，请确认使用仓库内版本（`eslint@8.57.1` + `eslint-config-next@14.2.16`），然后重新执行：

```bash
rm -rf node_modules package-lock.json
npm install
```

## Cloudflare Workers 部署（单实例 / 边缘分布式）

这个项目可以部署到 Cloudflare Workers。对于当前核心分析逻辑：

- 当前是无状态分析（同一个请求内基于固定 `analyzedAt` 计算），适合分布式边缘执行。
- 多个边缘节点不会破坏核心判断流程；影响主要是网络源可达性与请求延迟。
- API 会返回 `meta.execution = edge-distributed` 和可用时的 `workerRegion`，方便观察请求落点。

结论：可直接用 Cloudflare 边缘分布式模式达成，不必为了"单节点"牺牲可用性。

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

### 与 main 同步（推荐）

可以直接在本地先把当前分支和 `main` 对齐，再发 PR：

```bash
npm run sync:main
```

默认会执行 `rebase`。如果你更习惯 merge：

```bash
bash scripts/sync-with-main.sh origin main merge
```

脚本会在冲突时列出冲突文件并给出下一步命令。

## 开发协作（避免 PR 冲突）

单人开发也可能因为多次并行提交导致 PR 冲突。建议每次提交前先执行：

```bash
git fetch origin
git rebase origin/main
```

若有冲突，先本地解决后再 push，避免在 PR 页面留冲突状态。

## 未来可扩展

- 接入更多源（Reddit / Telegram / 新闻 API）
- Agent debate / critic 机制
- 证据图谱与时间线追踪
- 持久化（D1 / KV / R2）用于历史追踪
- 若未来有"全局单写状态"需求，可单独引入 Durable Object 作为协调层
