# Changelog

格式: [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)
版本号: [SemVer 2.0.0](https://semver.org/lang/zh-CN/)
写作风格: 单条目一行 ≤ 200 字符 + 视角面向消费者（详见 hazeflow/_shared/versioning.md）

## [Unreleased]
### Added
- 开源仓库骨架：AGPL-3.0 协议，检测站可在本地构建、预览并部署到 Cloudflare Workers
- 检测站首版上线 claude-analysis.ohaze.workers.dev：出口 IP、IP 属性与风险、环境指纹、交叉比对、WebRTC / DNS 泄露、延迟与服务状态
- Anthropic 8 个域名出口一致性与 IP 漂移检测，能发现分流规则漏掉 Claude Code 域名、轮询节点来回切 IP
- 每项按客观规则标「正常 / 注意 / 异常 / 未知」并汇总数量，不出总分
- IP 默认打码，可一键显示；「复制报告」自动打码且不含国内 IP，方便发群求助
- 隐私页逐项列出：哪些只在本地、哪些发往本站服务器、浏览器和服务器分别会访问哪些第三方
- 顶部「发现的问题」清单，点击跳到对应项；「出口一览」表并排对比 Claude、国内网站、WebRTC、DNS 的出口
- 每项右侧彩色标签直接写结论（「未检测到」「8/8 一致」等），出口 IP 附国旗；页脚链接到 GitHub 源码
- IP 风险拆成 VPN / 代理 / Tor / 滥用记录 / 风险分五项，同时查询 proxycheck.io 与 ipapi.is，任一家标记即命中并注明由谁标记
- WebRTC 暴露的 IP 在本地比对大陆 IP 段，泄露国内 IP 时标红「泄露国内 IP」，这个 IP 不会发往任何服务器
### Changed
### Fixed
### Removed

## [0.1.0] - 2026-09-30 — initial
### Added
- 项目初始化：四件套 + 检测站 / 数据站方案定稿
