// 环境判定：检测站结论卡与问卷站看板共用同一套扣分规则（docs/specs/board.md「环境判定」）。
// 两站只显示「通过 / 不通过」和扣分明细，不显示分数；权重是初始值，等问卷「封禁原因」数据校准，改权重先改 spec
import type { CheckId, Status } from './index';

/** 满分 100，扣到这个分数以下不通过 */
export const ENV_PASS_SCORE = 60;

export interface Deduction {
  id: CheckId;
  label: string;
  points: number;
}

export interface EnvVerdict {
  /** 一类里的检测项全是「未知」（检测失败）时无法判断 */
  unknown: boolean;
  pass: boolean;
  /** 判成「异常」的项：网络环境有任何一项就不通过 */
  fatal: CheckId[];
  deductions: Deduction[];
  /** 100 − 扣分合计；只用于判定，不展示 */
  score: number;
}

/** 网络环境：任何一项「异常」直接不通过；「注意」按 NETWORK_WARN 扣分 */
export const NETWORK_CHECKS: readonly CheckId[] = [
  'exit.proxied',
  'exit.consistency',
  'exit.drift',
  'ip.region',
  'ip.native',
  'ip.type',
  'ip.vpn',
  'ip.proxy',
  'ip.tor',
  'ip.abuser',
  'ip.score',
  'leak.webrtc',
  'leak.dns',
];

/** 设备指纹：这类检测项最多判到「注意」，全部按 FINGERPRINT_WARN 扣分 */
export const FINGERPRINT_CHECKS: readonly CheckId[] = [
  'fp.timezone',
  'fp.language',
  'fp.locale',
  'fp.fonts',
  'fp.browser',
  'fp.device',
  'cross.timezone',
  'cross.language',
];

/** 「注意」扣分：[明细里的说法, 扣分] */
export const NETWORK_WARN: Partial<Record<CheckId, [string, number]>> = {
  'ip.vpn': ['VPN 只有一家标记', 15],
  'ip.proxy': ['代理只有一家标记', 15],
  'ip.tor': ['Tor 只有一家标记', 15],
  'leak.webrtc': ['WebRTC 出口与 Claude 不同', 15],
  'leak.dns': ['有港澳 DNS 解析器', 15],
  'ip.type': ['机房 IP 或数据源分歧', 10],
  'ip.native': ['广播 IP', 10],
  'ip.abuser': ['只有一家有滥用记录', 10],
  'ip.score': ['中风险分', 10],
  'exit.consistency': ['部分域名请求失败', 5],
};

export const FINGERPRINT_WARN: Partial<Record<CheckId, [string, number]>> = {
  'fp.timezone': ['中国或港澳时区', 40],
  'fp.browser': ['国产浏览器', 30],
  'fp.device': ['国产设备', 20],
  'cross.timezone': ['时区与 IP 不一致', 20],
  'fp.language': ['浏览器语言含简体中文', 10],
  'cross.language': ['语言与 IP 地区矛盾', 10],
  'fp.locale': ['简体中文区域格式', 5],
  'fp.fonts': ['中文环境字体', 5],
};

type Statuses = Partial<Record<CheckId, Status>>;

function judge(status: Statuses, checks: readonly CheckId[], warn: Partial<Record<CheckId, [string, number]>>, badIsFatal: boolean): EnvVerdict {
  const fatal = badIsFatal ? checks.filter((id) => status[id] === 'bad') : [];
  const deductions = checks.flatMap((id): Deduction[] => {
    const s = status[id];
    const w = warn[id];
    // 设备指纹没有「异常」一档，万一出现也按「注意」扣
    return w && (s === 'warn' || (s === 'bad' && !badIsFatal)) ? [{ id, label: w[0], points: w[1] }] : [];
  });
  const score = 100 - deductions.reduce((sum, d) => sum + d.points, 0);
  // 「未知」跳过；一类里没有任何一项有结论时无法判断
  const unknown = !checks.some((id) => status[id] && status[id] !== 'unknown');
  return { unknown, pass: !unknown && !fatal.length && score >= ENV_PASS_SCORE, fatal, deductions, score };
}

export const judgeNetwork = (status: Statuses): EnvVerdict => judge(status, NETWORK_CHECKS, NETWORK_WARN, true);
export const judgeFingerprint = (status: Statuses): EnvVerdict => judge(status, FINGERPRINT_CHECKS, FINGERPRINT_WARN, false);
