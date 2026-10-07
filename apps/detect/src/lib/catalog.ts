// 检测项目录：页面骨架（Astro）与检测脚本共用这一份
import type { CheckId } from '@claude-analysis/shared';
import type { IconName } from './icons';

export interface CheckDef {
  id: CheckId;
  label: string;
  hint?: string;
  /** IP 信息大卡的字段图标 */
  icon?: IconName;
}

/** 读取 trace 的 Anthropic 域名；Claude Code 走 api.anthropic.com */
export const ANTHROPIC_DOMAINS = [
  'claude.ai',
  'api.anthropic.com',
  'a-api.anthropic.com',
  'claude.com',
  'platform.claude.com',
  'console.anthropic.com',
  'code.claude.com',
  'www.anthropic.com',
] as const;

/** IP 信息大卡：Claude 出口 IP 的属性 */
export const IP_ATTRS: CheckDef[] = [
  { id: 'ip.region', label: '地区', icon: 'flag' },
  { id: 'ip.native', label: '原生 IP', icon: 'badge' },
  { id: 'ip.type', label: '网络类型', icon: 'server' },
  { id: 'ip.asn', label: 'ASN', icon: 'hash' },
  { id: 'ip.org', label: '运营商', icon: 'building' },
  { id: 'ip.location', label: '位置', icon: 'pin' },
];

/** IP 信息大卡：风险标记 */
export const IP_RISKS: CheckDef[] = [
  { id: 'ip.vpn', label: 'VPN', icon: 'shield' },
  { id: 'ip.proxy', label: '代理', icon: 'shuffle' },
  { id: 'ip.tor', label: 'Tor', icon: 'layers' },
  { id: 'ip.abuser', label: '滥用记录', icon: 'alert' },
  { id: 'ip.score', label: '风险分', icon: 'gauge' },
];

/** 出口一览表：流量离开你设备的每条通道并排对比 */
export const EXIT_ROWS: CheckDef[] = [
  { id: 'exit.claude', label: 'claude.ai', hint: '网页版与 App' },
  { id: 'exit.api', label: 'api.anthropic.com', hint: 'Claude Code 与 API' },
  { id: 'exit.domestic', label: '国内网站', hint: '仅本地显示，不上传' },
  { id: 'leak.webrtc', label: 'WebRTC', hint: 'UDP，可能绕过代理' },
  { id: 'leak.dns', label: 'DNS 解析器', hint: '谁在帮你查域名' },
];

/** 出口一览表下方的检测卡 */
export const EXIT_CHECKS: CheckDef[] = [
  { id: 'exit.proxied', label: 'Claude 是否走代理' },
  { id: 'exit.consistency', label: '多域名出口', hint: `${ANTHROPIC_DOMAINS.length} 个 Anthropic 域名` },
  { id: 'exit.drift', label: 'IP 漂移', hint: '约 10 秒内采样 5 次' },
];

export const AVAIL_CHECKS: CheckDef[] = [
  { id: 'avail.claude', label: 'claude.ai', hint: '延迟中位数' },
  { id: 'avail.api', label: 'api.anthropic.com', hint: '延迟中位数' },
  { id: 'avail.status', label: '服务状态', hint: 'status.claude.com' },
];

export const FP_CHECKS: CheckDef[] = [
  { id: 'fp.timezone', label: '系统时区' },
  { id: 'fp.language', label: '浏览器语言' },
  { id: 'fp.locale', label: '区域格式', hint: '日期与数字格式' },
  { id: 'fp.fonts', label: '中文字体' },
  { id: 'fp.browser', label: '国产浏览器 / App' },
  { id: 'fp.device', label: '国产设备 / 系统' },
];

export const CROSS_CHECKS: CheckDef[] = [
  { id: 'cross.timezone', label: '系统时区与 IP 时区' },
  { id: 'cross.language', label: '浏览器语言与 IP 地区' },
];

/** 检测项分组，顺序即页面顺序；「发现的问题」的分组前缀用 title */
export const GROUPS: Array<{ title: string; checks: CheckDef[] }> = [
  { title: 'IP 信息', checks: [...IP_ATTRS, ...IP_RISKS] },
  { title: '出口一览', checks: [...EXIT_ROWS, ...EXIT_CHECKS] },
  { title: '可用性', checks: AVAIL_CHECKS },
  { title: '环境指纹', checks: FP_CHECKS },
  { title: '交叉比对', checks: CROSS_CHECKS },
];

/** 检测项在页面上的锚点，「发现的问题」据此跳转 */
export const anchorOf = (id: CheckId) => `check-${id.replace('.', '-')}`;

export const CHECKS: CheckDef[] = GROUPS.flatMap((g) => g.checks);
