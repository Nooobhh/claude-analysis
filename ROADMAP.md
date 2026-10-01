# claude-analysis Roadmap
> 项目 overview（现在 + 未来）。已发布历史看 CHANGELOG.md，agent 指令看 CLAUDE.md。

## 当前主线
0.2.0 — 检测站首版上线（workers.dev）

- [x] 脚手架：pnpm monorepo + `apps/detect`（Astro + Worker）+ `packages/shared` + LICENSE
- [x] DESIGN.md：Vercel 风中立工具风
- [x] 出口 IP：claude.ai / api.anthropic.com / 国内出口 + Anthropic 多域名一致性 + IP 漂移
- [x] IP 属性与风险：`/api/ip`（ipapi.is 主、ipinfo 兜底，限频 + 哈希缓存）
- [x] 环境指纹 + 交叉比对（时区 / 语言 / 字体等，只标单项状态不出总分）
- [x] WebRTC UDP 泄露 + DNS 泄露（Fastly 主、Surfshark / ipleak 兜底）
- [x] 可用性：延迟 + 服务状态（Worker 中转状态页）
- [x] 隐私页 + 复制检测报告（已打码）
- [x] 本地 `wrangler deploy` 上线 workers.dev
- [x] 风险数据源：接入 proxycheck.io（VPN / 代理 / Tor / 机房 / 风险分）
- [x] 界面：问题清单 + 出口一览表 + 彩色结论标签 + 国旗（DESIGN.md 同步）
- [x] 仓库公开：github.com/Nooobhh/claude-analysis
- [x] 配置 `PROXYCHECK_KEY`（线上 Workers 共享出口的匿名额度已被占满）

## Backlog
- P1 数据站首版：问卷 + 检测结果签名 token 一键带入 + 匿名管理链接（可更新 / 删除）
- P1 GitHub Actions 自动部署 + 页脚 commit hash：让人核对线上跑的就是仓库代码（需在仓库配 CF API token）
- P2 看板：按维度展示封禁占比 + 置信区间，n≥30 才出结论；检测页显示「本站反馈」
- P2 教程：检测项链到对应修复教程
- P3 评分：用数据站封号数据校准权重后再出分
- P3 Claude Code 终端自检：一条 curl 命令查 TZ / LANG / 代理变量
- P3 购买独立域名（不含 claude），面向国内引流
- P3 `/api/ip` 每日总量闸门：限频只有 10s / 60s 窗口，挡不住多 IP 刷光数据源日额度；出现被刷再做

## Bug

## 长期目标
- 积累足够样本，给出「哪些环境因素与封号相关」的可信统计
- 跑通「检测 → 教程修复 → 回报数据」的闭环
- 开源 + 数据最小化，做可信的中立数据源
