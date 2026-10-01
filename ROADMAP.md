# claude-analysis Roadmap
> 项目 overview（现在 + 未来）。已发布历史看 CHANGELOG.md，agent 指令看 CLAUDE.md。

## 当前主线
0.4.0 — 问卷站首版：匿名问卷收集封号数据，检测结果一键带入（问卷设计见 [docs/specs/survey.md](./docs/specs/survey.md)）

- [ ] 检测站生成签名检测结果码，加「复制结果码」按钮
- [ ] 问卷站部署到 Cloudflare Workers（另一个 workers.dev 域名）+ 选存储
- [ ] 问卷页：5 步向导、检测 / 手动两条环境路径、提交校验
- [ ] 匿名管理链接：修改 / 删除，状态变化记事件
- [ ] 问卷站隐私页

## Backlog
- P2 看板：按维度展示封禁占比 + 置信区间，n≥30 才出结论；检测页显示「本站反馈」
- P2 教程：检测项链到对应修复教程
- P3 ASN 人机流量：接 Cloudflare Radar（需 Radar API token），显示出口 ASN 的人类 / 机器流量占比
- P3 评分：用数据站封号数据校准权重后再出分
- P3 Claude Code 终端自检：一条 curl 命令查 TZ / LANG / 代理变量
- P3 购买独立域名（不含 claude），面向国内引流
- P3 `/api/ip` 每日总量闸门：限频只有 10s / 60s 窗口，挡不住多 IP 刷光数据源日额度；出现被刷再做

## Bug

## 长期目标
- 积累足够样本，给出「哪些环境因素与封号相关」的可信统计
- 跑通「检测 → 教程修复 → 回报数据」的闭环
- 开源 + 数据最小化，做可信的中立数据源
