# claude-analysis
> Claude 使用环境检测 + 封号数据统计：检测出口 IP 与环境指纹，众包统计不同环境下的封禁情况（开源、隐私优先）

## 是什么

检测站：<https://claude-analysis.ohaze.workers.dev> ｜ 源码：<https://github.com/Nooobhh/claude-analysis>

两个站，一个仓库。检测站是项目主体、长期维护；问卷站是阶段性的附属站点，用来收集封号数据：

- **检测站**：在浏览器里检测你访问 Claude 时的网络环境——Claude 各域名的出口 IP 是否一致、IP 是否漂移、IP 属性与风险标记、系统时区 / 语言 / 字体等环境指纹、WebRTC 与 DNS 泄露、服务可用性。
- **问卷站**（claudeban.ohaze.workers.dev）：匿名问卷收集使用环境与封号结果，检测结果复制「结果码」即可带入；看板 `/board` 按使用环境、用户行为两类把问卷分进四个象限（一个点一份问卷），分别比较各因素与封号的关系。问卷站不读取、不保存 IP。

## 为什么

现有的检测站只告诉你「IP 干不干净」，没人知道哪些环境因素真的和封号相关。本项目用众包数据回答这个问题，并且把代码和隐私处理全部公开，让人放心填写。

## 架构

```
检测站（Cloudflare Workers，不存数据）
  浏览器本地：各出口 IP、指纹、WebRTC、DNS 泄露
  Worker：/api/ip（查 IP 属性）、/api/status（服务状态中转）
        │ 结果码（签名，不含原始 IP；用户复制粘贴）
        ▼
问卷站 claudeban（Cloudflare Workers，唯一存数据的地方，不读取 IP）
  问卷 / 看板（/api/board 只下发汇总份数）/ 之后：教程、公开聚合数据
```

## 常用命令

需要 Node 22+ 和 pnpm 10。

```bash
pnpm install
pnpm dev          # 检测站前端 http://localhost:4321（/api 代理到 :8787）
pnpm dev:worker   # 构建后用 wrangler dev 跑 Worker + 静态资源 http://localhost:8787
pnpm dev:data     # 问卷站前端 http://localhost:4322（/api 代理到 :8788）
pnpm dev:data-worker  # 构建后用 wrangler dev 跑问卷站 Worker + 本地 D1 http://localhost:8788
pnpm build        # 构建检测站到 apps/detect/dist
pnpm typecheck    # 生成 Worker 类型，检查两站与 Worker 的类型
pnpm run deploy   # 本地手动部署检测站，仅应急用（需先 wrangler login；不能省略 run）
pnpm run deploy:data  # 同上，部署问卷站
```

## 部署

推送到 `main` 后由 GitHub Actions（`.github/workflows/deploy.yml`）自动做类型检查，并先后部署检测站与问卷站（claudeban.ohaze.workers.dev）到 Cloudflare Workers。页脚显示的 commit 就是线上正在运行的代码，可以点开核对。

仓库需要配置：

- Secret `CLOUDFLARE_API_TOKEN`：在 Cloudflare 用「Edit Cloudflare Workers」模板创建
- Secret `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID（放 Secret 是为了在公开的 Actions 日志里被屏蔽）

Worker 运行时用到的 secret（见下方「配置」）存在 Cloudflare 上，部署不会覆盖。

问卷站的数据存在 Cloudflare D1（数据库 `claudeban`），表结构在 `apps/data/migrations/`。CI 不改表结构；新增 migration 后，先在本地执行 `pnpm --filter @claude-analysis/data exec wrangler d1 migrations apply claudeban --remote`，再推送部署。

## 配置

Worker 用到的 secret（线上用 `wrangler secret put <名字>` 设置，本地写进 `apps/detect/.dev.vars`）：

| 名字 | 必需 | 作用 |
|---|---|---|
| `IP_HASH_SALT` | 是 | IP 缓存与限频 key 的哈希盐；缺失时不缓存 |
| `PROXYCHECK_KEY` | 线上是 | [proxycheck.io](https://proxycheck.io) 免费账号 key（每天 1000 次）。Workers 出口 IP 多人共享，匿名额度在线上基本被占满 |
| `IPAPI_KEY` | 否 | [ipapi.is](https://ipapi.is) 免费账号 key（每天 1000 次）；配置后与 proxycheck 并行查询，风险项取并集（注册需用非代理网络） |
| `IPINFO_TOKEN` | 否 | ipinfo.io token；前两个都失败时的兜底，只有基础属性 |
| `RESULT_CODE_KEY` | 否 | 结果码签名私钥（Ed25519，PKCS#8 base64），对应公钥写在问卷站 `apps/data/src/lib/result-code.ts`；未配置时检测页不能复制结果码 |

中国大陆 IPv4 段（`apps/detect/public/cn-ipv4.bin`，用于本地判断 WebRTC 泄露的 IP）从 APNIC 分配表生成，刷新：`pnpm --filter @claude-analysis/detect gen:cn-ipv4`。

## 隐私原则

- 国内出口 IP（即你的真实宽带 IP）只在你的浏览器里显示，不会发往任何服务器
- 服务器只收到用于查询属性的 Claude 出口 IP，缓存用加盐 hash、24 小时过期，不记访问日志
- 环境指纹全部在本地计算，不上传；「复制结果码」在浏览器里拼装，不发送数据，结果码不含任何 IP
- 没有任何统计、广告或追踪脚本
- 页面会访问哪些第三方服务，隐私页逐个列明

## 致谢

- [FuckClaude](https://github.com/LinXiaoTao/FuckClaude)（MIT）— 环境指纹检测思路
- [MyIP](https://github.com/jason5ng32/MyIP)（MIT）— IP / WebRTC / DNS 泄露检测思路
- [flag-icons](https://github.com/lipis/flag-icons)（MIT）— 国旗图标
- [APNIC](https://www.apnic.net) 分配数据 — 中国大陆 IP 段

## License

[AGPL-3.0](./LICENSE)

## 历史
进度路线见 [ROADMAP.md](./ROADMAP.md)，已发布版本见 [CHANGELOG.md](./CHANGELOG.md)。
