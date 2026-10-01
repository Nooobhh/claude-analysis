# claude-analysis
> Claude 使用环境检测 + 封号数据统计：检测出口 IP 与环境指纹，众包统计不同环境下的封禁情况（开源、隐私优先）

> README ./README.md ｜ ROADMAP ./ROADMAP.md ｜ CHANGELOG ./CHANGELOG.md

## 项目类型
- 类型: 发行产品   <!-- 发行产品 / 工作流项目 / 入口项目 / wrapper 容器 -->
- 集群归属: 未分类
- 状态: active
- 版本: 0.1.0

## Agent 行为约定
- 继承全局 ~/CLAUDE.md 编码原则；不走 /ohaze:ship，按 ROADMAP 当前主线逐项直接开发，每步汇报
- 前端样式唯一依据 = `DESIGN.md`（Vercel 风中立工具风，Geist 自托管）
- 可借用 FuckClaude / MyIP（均 MIT）的代码，搬运时在文件头保留原版权声明
- 当前阶段不做总分 / 加权评分，单项只按客观规则标「正常 / 注意 / 异常」；评分等数据站样本足够后校准

## 关键文件 / 命令
- 结构：pnpm monorepo；检测站 `apps/detect`（Astro 7 静态页 + CF Worker），两站共用类型 `packages/shared`
- 命令（根目录）：`pnpm dev`（Astro :4321，`/api` 代理到 :8787）、`pnpm dev:worker`（构建后 wrangler dev :8787）
- 命令（根目录）：`pnpm build`、`pnpm typecheck`（wrangler types + Worker 与前端 tsc）、`pnpm run deploy`（构建 + 部署）
- `pnpm deploy` 是 pnpm 内置命令，部署必须写 `pnpm run deploy`
- Worker 入口 `apps/detect/worker/index.ts`，只接 `/api/*`；配置 `apps/detect/wrangler.jsonc`
- 检测项：ID 在 shared `CHECK_IDS`，文案在 `src/lib/catalog.ts`，判定在 `src/lib/checks/*`，调度在 `src/scripts/detect.ts`
- Worker secret：`IP_HASH_SALT`、`PROXYCHECK_KEY`、`IPAPI_KEY`（线上均已配置）；可选 `IPINFO_TOKEN`；本地放 `.dev.vars`
- IP 数据源或 `IpInfo` 结构变了，递增 `worker/index.ts` 的 `IP_CACHE_VERSION`，否则 24h 内读到旧缓存
- 大陆 IPv4 段 `public/cn-ipv4.bin` 由 `pnpm --filter @claude-analysis/detect gen:cn-ipv4` 从 APNIC 生成
- `compatibility_date` 不能晚于本地 workerd 版本日期；改 wrangler.jsonc 后跑 `pnpm typecheck` 重生成类型

## 编码约束
- 隐私红线：国内出口 IP 只在浏览器本地显示，永不发往任何后端
- 后端只接收 Claude 出口 IP 用于查属性；缓存 key 用加盐 hash、TTL 24h，Worker 不记访问日志
- 零第三方前端脚本（统计 / 广告 / 像素 / CDN 一律禁止）；浏览器必须访问的第三方全部列进隐私页
- `/api/ip` 不提供任意 IP 查询：按调用方限频，传入 IP ≠ 请求者 IP 时收紧限额
- 检测结果 JSON 结构与问卷字段 schema 统一放 `packages/shared`，两站共用，不各自定义

## 集成点
- 检测站：Cloudflare Workers（静态资源 + Worker API + KV 缓存），线上 `claude-analysis.ohaze.workers.dev`
- 仓库：`github.com/Nooobhh/claude-analysis`（公开）；页脚链接写在 `src/layouts/Base.astro` 的 `REPO_URL`
- 数据站（后续）：tokyo 服务器，Caddy 反代；接收检测站签名 token，不接收原始 IP
- 浏览器直连：Anthropic 8 域名 trace、ipip.net / 又拍云（国内 IP）、Cloudflare / Google STUN、Fastly / Surfshark / ipleak（DNS）
- Worker 访问：proxycheck.io + ipapi.is 并行（记 `flaggedBy` / `typeBy`，分歧前端并排显示），ipinfo.io 兜底；status.claude.com
- 原生 IP：Worker 查 RDAP（先 RIPE 后 ARIN，各 RIR 互相跳转；ARIN 对 Workers 常 525），ARIN 取注册人地址末行
- Workers 出口 IP 多人共享，第三方匿名额度在线上基本不可用（2026-09-30 实测 proxycheck 403、ipinfo 429），一律配 key
- 增删任何第三方必须同步 `src/pages/privacy.astro` 的清单

<!-- 本文件只记 agent 指令。进度 / 待办 / bug → ROADMAP.md；版本变更 → CHANGELOG.md -->
