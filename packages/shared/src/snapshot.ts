// 检测快照：检测站产出，经结果码带入问卷。分两部分——
// signed：检测站服务器对自己查到的 IP 属性签名（不含 IP 本身），浏览器改不了；
// local：浏览器本地得出的结论，不经过服务器，可信度与问卷自报相同。
// 两部分都不含任何 IP、城市，国内出口相关的一律不进；字段取舍见 docs/specs/survey.md
import type { CheckId, CountryCode, IpRisk, Status } from './index';

export const SNAPSHOT_VERSION = 1;

/** 服务器查到的 Claude 出口 IP 属性（来自 /api/ip，与检测页显示的是同一份） */
export interface SnapshotIp {
  /** IP 数据库给出的国家 */
  country: CountryCode | null;
  asn: number | null;
  org: string | null;
  /** 两家数据源各自的网络类型；风险数据源都不可用时为空对象 */
  typeBy: IpRisk['typeBy'];
  /** 各风险项由哪些数据源标记；风险数据源都不可用时为 null */
  flaggedBy: IpRisk['flaggedBy'] | null;
  riskScore: number | null;
  /** IP 段登记国家（RDAP），判断原生 IP 用 */
  regCountry: CountryCode | null;
}

/** 检测站服务器签名的部分 */
export interface SignedSnapshot {
  v: typeof SNAPSHOT_VERSION;
  /** 签发时间，Unix 秒；结果码有效期从这里算 */
  at: number;
  /** 随机数：同一秒内的两次检测也得到不同结果码，问卷据此判断是否重复使用 */
  n: string;
  ip: SnapshotIp;
}

/** disabled = 浏览器禁用 WebRTC；none = 无泄露；mainland = 泄露大陆 IP；other = UDP 出口与 Claude 出口不同 */
export type WebrtcLeak = 'disabled' | 'none' | 'mainland' | 'other';

export const OS_FAMILIES = ['windows', 'macos', 'linux', 'ios', 'android', 'other'] as const;
export const BROWSER_FAMILIES = ['chrome', 'edge', 'firefox', 'safari', 'other'] as const;

/** 浏览器本地得出的部分 */
export interface LocalSnapshot {
  /** 检测站版本号与 commit：判定规则会变，留着可回算 */
  version: string;
  commit: string;
  /** 各检测项的判定结果；纯信息项（没有状态）不带 */
  status: Partial<Record<CheckId, Status>>;
  /** claude.ai 出口国家（Cloudflare trace，也就是 Claude 那边看到的）；null = 访问失败 */
  exitCountry: CountryCode | null;
  fp: {
    /** IANA 时区名 */
    timezone: string;
    offsetMin: number;
    /** 浏览器语言列表前 3 个 */
    languages: string[];
    locale: string;
    /** 有系统默认之外的中文 / 国产厂商字体 */
    cnFonts: boolean;
    /** 国产浏览器 / App 名，未检测到为 null */
    cnBrowser: string | null;
    /** 国产设备品牌 / 系统，未检测到为 null */
    cnDevice: string | null;
    os: (typeof OS_FAMILIES)[number];
    browser: (typeof BROWSER_FAMILIES)[number];
  };
  leak: {
    webrtc: WebrtcLeak;
    /** DNS 解析器所在国家（去重）；null = 检测失败 */
    dnsCountries: CountryCode[] | null;
  };
}

export interface DetectSnapshot {
  signed: SignedSnapshot;
  local: LocalSnapshot;
}
