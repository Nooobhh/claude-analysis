// 检测快照：检测站生成、签名后经「带入问卷」交给数据站。
// 只放判定用的事实，不放任何 IP、城市，国内出口相关的一律不进；字段取舍见 docs/specs/survey.md
import type { CheckId, CountryCode, IpRisk, Status } from './index';

export const SNAPSHOT_VERSION = 1;

/** disabled = 浏览器禁用 WebRTC；none = 无泄露；mainland = 泄露大陆 IP；other = UDP 出口与 Claude 出口不同 */
export type WebrtcLeak = 'disabled' | 'none' | 'mainland' | 'other';

export interface DetectSnapshot {
  v: typeof SNAPSHOT_VERSION;
  /** 生成时间，Unix 秒 */
  at: number;
  /** 检测站版本号与 commit：判定规则会变，留着可回算 */
  version: string;
  commit: string;
  /** 各检测项的判定结果；纯信息项（没有状态）不带 */
  status: Partial<Record<CheckId, Status>>;
  /** claude.ai 出口国家（Cloudflare trace）；null = 访问失败 */
  exitCountry: CountryCode | null;
  /** Worker 从自己的缓存回填，浏览器改不了；查询失败为 null */
  ip: {
    asn: number | null;
    org: string | null;
    typeBy: IpRisk['typeBy'];
    flaggedBy: IpRisk['flaggedBy'];
    riskScore: number | null;
    /** IP 段登记国家（RDAP），判断原生 IP 用 */
    regCountry: CountryCode | null;
  } | null;
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
    /** 系统家族：windows / macos / linux / ios / android / other */
    os: string;
    /** 浏览器家族：chrome / edge / firefox / safari / other */
    browser: string;
  };
  leak: {
    webrtc: WebrtcLeak;
    /** DNS 解析器所在国家（去重）；null = 检测失败 */
    dnsCountries: CountryCode[] | null;
  };
}
