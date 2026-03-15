# osint-pointer

基于 **Next.js + React + TypeScript + HeroUI** 的 **完整 OSINT 数据分析 + Dashboard** 产品：自动拉取**近 3 天** OSINT（建议**每 30 分钟**执行一次更新）、经 **MiniMax** 等 LLM 分析后输出 5–10 个黑天鹅事件（含**持续事件**如俄乌冲突与**新兴事件**区分）、置信度与归因，并在同一页展示多维度 Dashboard。

---

## 产品能力

- **数据层**：后端从 **Nitter RSS** 拉取一组 OSINT 信源（X 账号）的时间线；某账号拉取失败时用该账号名做搜索回退。信源列表可在 **`src/config/osint-sources.json`** 中自行增删。默认抓取**近 3 天**数据（更新频率由调用方控制，如每 30 分钟请求一次接口）；若 3 天内 0 条则改用「最近 N 条」。上下文管理：按日分组、采样后送 LLM（约 140 条），便于模型识别**连贯/持续事件**（如俄乌战争）与新兴事件。**关于能否从 X 扒到数据**：Nitter 为第三方镜像，实例可能不稳定或被限流；本应用已做多实例、多路径重试与搜索回退，仍可能偶发拉不到数据，属正常情况，可稍后重试或自建 Nitter。
- **分析层**：将聚合后的 OSINT 文本发送至 **MiniMax API**（默认），由模型完成事件抽取、黑天鹅判定、发生概率与简要依据、时间线节点与综合风险等级。MiniMax M2.5 / M2 支持推理能力（thinking），适合复杂分析。
- **输出**：
  1. **顶部**：**5–10 个**黑天鹅事件卡片，含**持续事件**（如俄乌冲突、中东局势，标 parentTopic）与**新兴事件**；每卡含事件名、地点、前因后果、**置信度**（颜色区分）、**对全球金融与贸易的影响**、证据来源。
  2. **下方**：Dashboard——条形图、雷达图、时间线（近 3 天）、树状图、归因节点图、综合风险等级。
- **前端**：单页展示上述结果，数据来自真实流水线；未配置 API Key 时接口返回 503，页面提示配置 `MINIMAX_API_KEY`。

---

## 环境变量（必配）

| 变量 | 必填 | 说明 |
|------|------|------|
| `MINIMAX_API_KEY` 或 `LLM_API_KEY` | 是 | MiniMax 调用密钥，在 [platform.minimax.io](https://platform.minimax.io) 账户管理 → 接口密钥 创建。 |
| `LLM_BASE_URL` | 否 | API 基础 URL，不填默认 `https://api.minimax.io`（官方 Text 接口）。 |
| `LLM_MODEL` | 否 | 模型名称，不填默认 `MiniMax-M2.5`。可选：`MiniMax-M2`（更强推理）、`MiniMax-M2.5-highspeed`（更快）。 |

复制 `.env.example` 为 `.env` 并填入 `MINIMAX_API_KEY`，重启开发服务器后即可使用完整数据分析与 Dashboard。

```bash
cp .env.example .env
# 编辑 .env 填入 MINIMAX_API_KEY=你的密钥
npm run dev
```

---

## 技术栈

- Next.js 14 (App Router)、React 18、TypeScript、HeroUI、Tailwind
- **API**
  - `GET /api/black-swan`：执行「近 3 天 OSINT 拉取 → MiniMax 分析」，返回 5–10 个黑天鹅事件（含持续/新兴标注）与 Dashboard 指标。**本地/Node 运行时**会优先读 `.cache/black-swan.json` 缓存（5 分钟 TTL），命中则直接返回，避免重复拉取与调用 LLM；部署到 Cloudflare Workers 时无 fs，不会使用文件缓存，可自行接 KV 实现。
  - `GET /api/analyze?query=...`：按关键词抓取 X 并做单条推文可信度打分（规则引擎，无需 API Key）。
- 部署：可走 Cloudflare Workers。**部署前必须先构建**：`npm run deploy:worker` 会先执行 `build:worker` 生成 `.open-next/worker.js`，再执行 `wrangler deploy`。CI/云端若只跑 `wrangler deploy` 会报错「entry-point file .open-next/worker.js was not found」，请改为使用 `npm run deploy:worker` 或先跑 `npm run build:worker` 再跑 `wrangler deploy`。需在 Workers 环境配置 `MINIMAX_API_KEY` 等。

---

## 本地开发

```bash
npm install
cp .env.example .env   # 填入 MINIMAX_API_KEY
npm run dev
```

打开 `http://localhost:3000`。首页即完整数据分析 + Dashboard；未配置 API Key 时页面会提示前往 MiniMax 平台获取。

---

## 信源配置（自定义 X 账号）

编辑 **`src/config/osint-sources.json`** 中的 `handles` 数组即可增删信源（无需 `@` 前缀），例如：

```json
{
  "description": "OSINT 信源 X 账号列表",
  "handles": [
    "osinttechnical",
    "conflict_radar",
    "Osint613",
    "ConflictsW",
    "你的其他账号"
  ]
}
```

项目根目录的 **`config/osint-sources.json`** 为同结构示例，复制到 `src/config/osint-sources.json` 或按需合并使用。

## X 数据获取与 Nitter 可靠性

- 本应用**不直接调用 X/Twitter 官方 API**，而是通过 **Nitter** 的 RSS 接口间接获取推文（用户时间线或关键词搜索）。
- Nitter 为社区维护的第三方镜像，实例可能**不稳定、被限流或暂时不可用**。代码中已使用多实例（如 nitter.poast.org、nitter.privacydev.net 等）、多 RSS 路径（`/rss`、`/with_replies/rss`）重试，并在某账号时间线拉取失败时用该账号名做搜索回退。
- 若仍拉不到数据，页面会提示「当前无法从 OSINT 信源拉取到数据」；可稍后重试，或自建/选用其他 Nitter 实例（修改 `src/lib/x-source.ts` 中的 `NITTER_INSTANCES`）。

## Cloudflare KV 事记

事记只用 **wrangler 配置的 KV 绑定**：在 `wrangler.toml` 里配好 `OSINT_POINTER_KV` 后，本地（wrangler 跑）和部署到 Worker 都会用同一套绑定，无需 API Token 或 REST API。

在 [Dashboard](https://dash.cloudflare.com) → Workers 与 Pages → KV → 点进 namespace `osint-pointer` → 复制 **Namespace ID**，填到 `wrangler.toml` 的 `id` 即可。

## 其他

- 安装依赖问题：若遇 peer 依赖冲突，可 `rm -rf node_modules package-lock.json` 后 `npm install`。
- Cloudflare 部署：在 `wrangler.toml` 或 Dashboard 中配置 `MINIMAX_API_KEY` 等 Secrets。
- 旧版单条推文可信度分析：访问 `/analyze`。
