// 检测项目录：页面骨架（Astro）与检测脚本、复制报告共用这一份
import type { CheckId } from '@claude-analysis/shared';

export interface CheckDef {
  id: CheckId;
  label: string;
  hint?: string;
}

export interface CardDef {
  id: string;
  title: string;
  desc?: string;
  /** 桌面端横跨两列（内容长的卡片） */
  wide?: boolean;
  checks: CheckDef[];
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

/** 页面顶部的三张出口 IP 大卡片 */
export const IP_CARDS: CheckDef[] = [
  { id: 'exit.domestic', label: '国内出口', hint: '仅本地显示，不上传' },
  { id: 'exit.claude', label: 'claude.ai 出口', hint: '网页版与 App' },
  { id: 'exit.api', label: 'api.anthropic.com 出口', hint: 'Claude Code 与 API' },
];

export const CARDS: CardDef[] = [
  {
    id: 'exit',
    title: '出口检查',
    checks: [
      { id: 'exit.proxied', label: 'Claude 是否走代理' },
      { id: 'exit.consistency', label: '多域名出口', hint: `${ANTHROPIC_DOMAINS.length} 个 Anthropic 域名` },
      { id: 'exit.drift', label: 'IP 漂移', hint: '约 10 秒内采样 5 次' },
    ],
  },
  {
    id: 'ip',
    title: 'IP 属性',
    desc: '只有 claude.ai 出口 IP 会发给本站查询，结果缓存 24 小时',
    checks: [
      { id: 'ip.region', label: '地区' },
      { id: 'ip.type', label: '网络类型' },
      { id: 'ip.asn', label: 'ASN' },
      { id: 'ip.org', label: '运营商' },
      { id: 'ip.location', label: '位置' },
    ],
  },
  {
    id: 'risk',
    title: 'IP 风险标记',
    checks: [
      { id: 'ip.vpn', label: 'VPN' },
      { id: 'ip.proxy', label: '代理' },
      { id: 'ip.tor', label: 'Tor' },
      { id: 'ip.abuser', label: '滥用记录' },
      { id: 'ip.score', label: '风险分' },
    ],
  },
  {
    id: 'webrtc',
    title: 'WebRTC 泄露',
    desc: '通过 STUN 获取 UDP 出口，绕过代理时会暴露真实 IP',
    checks: [{ id: 'leak.webrtc', label: '状态' }],
  },
  {
    id: 'dns',
    title: 'DNS 泄露',
    desc: '随机子域名触发一次解析，看是谁在帮你查询',
    checks: [{ id: 'leak.dns', label: '状态' }],
  },
  {
    id: 'avail',
    title: '可用性',
    checks: [
      { id: 'avail.claude', label: 'claude.ai', hint: '延迟中位数' },
      { id: 'avail.api', label: 'api.anthropic.com', hint: '延迟中位数' },
      { id: 'avail.status', label: '服务状态', hint: 'status.claude.com' },
    ],
  },
  {
    id: 'fp',
    title: '环境指纹',
    desc: '网页能读到的系统特征，全部在本地计算',
    wide: true,
    checks: [
      { id: 'fp.timezone', label: '系统时区' },
      { id: 'fp.language', label: '浏览器语言' },
      { id: 'fp.locale', label: '区域格式', hint: '日期与数字格式' },
      { id: 'fp.fonts', label: '中文字体' },
      { id: 'fp.browser', label: '国产浏览器 / App' },
      { id: 'fp.device', label: '国产设备 / 系统' },
    ],
  },
  {
    id: 'cross',
    title: '交叉比对',
    desc: '单项正常、放在一起互相矛盾的组合',
    checks: [
      { id: 'cross.timezone', label: '系统时区与 IP 时区' },
      { id: 'cross.language', label: '浏览器语言与 IP 地区' },
    ],
  },
];

/** 复制报告的分组顺序 */
export const REPORT_GROUPS: Array<{ title: string; checks: CheckDef[] }> = [
  { title: '出口 IP', checks: IP_CARDS },
  ...CARDS,
];

export const CHECKS: CheckDef[] = REPORT_GROUPS.flatMap((g) => g.checks);
