// 两站共用的检测结果结构；检测站产出、数据站（后续）消费。

/** 单项状态：只按客观规则判定，不做加权评分 */
export type Status = 'ok' | 'warn' | 'bad' | 'unknown';

export const STATUS_LABEL: Record<Status, string> = {
  ok: '正常',
  warn: '注意',
  bad: '异常',
  unknown: '未知',
};

/** 检测项 ID：检测站渲染、复制报告、数据站问卷带入都用这一份 */
export const CHECK_IDS = [
  'exit.claude',
  'exit.api',
  'exit.domestic',
  'exit.proxied',
  'exit.consistency',
  'exit.drift',
  'ip.region',
  'ip.native',
  'ip.type',
  'ip.asn',
  'ip.org',
  'ip.location',
  'ip.vpn',
  'ip.proxy',
  'ip.tor',
  'ip.abuser',
  'ip.score',
  'fp.timezone',
  'fp.language',
  'fp.locale',
  'fp.fonts',
  'fp.browser',
  'fp.device',
  'cross.timezone',
  'cross.language',
  'leak.webrtc',
  'leak.dns',
  'avail.claude',
  'avail.api',
  'avail.status',
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckItem<T = unknown> {
  id: CheckId;
  /** 缺省 = 纯信息项，不参与异常 / 注意计数 */
  status?: Status;
  value: T;
  /** 判定依据，一句话，展示给用户 */
  reason?: string;
}

export type IpSource = 'ipapi.is' | 'proxycheck.io' | 'ipinfo';

/** 可被多个数据源各自标记的风险项 */
export type RiskFlag = 'vpn' | 'proxy' | 'tor' | 'abuser' | 'datacenter';

/** IP 风险标记；ipapi.is 与 proxycheck.io 并行查询后合并，任一家标记即命中 */
export interface IpRisk {
  /** 网络类型，统一小写：isp / residential / wireless / business / hosting / education / government / banking */
  type: string | null;
  isDatacenter: boolean;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isAbuser: boolean;
  isMobile: boolean;
  datacenter: string | null;
  vpnService: string | null;
  abuserScore: string | null;
  /** proxycheck.io 风险分 0–100；其他数据源为 null */
  riskScore: number | null;
  /** 每个风险项是哪些数据源标记的 */
  flaggedBy: Record<RiskFlag, IpSource[]>;
  /** 各数据源各自给出的网络类型原始值（两家分类角度不同，分歧时并排显示） */
  typeBy: Partial<Record<IpSource, string>>;
}

/** IP 段在注册机构（RIR）的登记信息，用于判断原生 IP */
export interface IpRegistration {
  /** 登记国家（ISO 3166-1 alpha-2，大写）；查不到为 null */
  country: string | null;
  /** ARIN / RIPE NCC / APNIC / LACNIC / AFRINIC */
  rir: string | null;
  /** 网段名 */
  netname: string | null;
}

/** POST /api/ip 返回的 IP 属性，已按数据源归一化 */
export interface IpInfo {
  ip: string;
  /** 实际返回了数据的数据源 */
  sources: IpSource[];
  /** ISO 3166-1 alpha-2，大写 */
  countryCode: string | null;
  region: string | null;
  city: string | null;
  /** IANA 时区名 */
  timezone: string | null;
  asn: number | null;
  org: string | null;
  /** null = 当前数据源不提供风险标记 */
  risk: IpRisk | null;
  /** RDAP 查到的登记信息；查询失败为 null */
  registration: IpRegistration | null;
}

/**
 * 网络类型中文名。两家的分类角度不同：proxycheck 看地址用途，ipapi.is 看所属机构，
 * 同一个英文值（business）意思也不同，所以分开翻译
 */
export const IP_TYPE_LABEL: Record<'proxycheck.io' | 'ipapi.is', Record<string, string>> = {
  'proxycheck.io': { residential: '家庭宽带', business: '企业线路', wireless: '移动网络', hosting: '机房' },
  'ipapi.is': { isp: '运营商', hosting: '机房', education: '教育网', government: '政府网络', banking: '金融机构', business: '其他机构' },
};

export type IpApiError = 'bad_request' | 'rate_limited' | 'upstream';
export type IpApiResponse =
  /** signed：检测站对这份 IP 属性的签名（结果码的 signed 段），未配置签名私钥时缺省 */
  | { ok: true; data: IpInfo; signed?: string }
  | { ok: false; error: IpApiError };

/** GET /api/status：status.claude.com 的精简转发 */
export interface ServiceStatus {
  /** none / minor / major / critical / maintenance */
  indicator: string;
  description: string;
  components: Array<{ name: string; status: string }>;
  incidents: Array<{ name: string; impact: string }>;
}

export type StatusApiResponse = { ok: true; data: ServiceStatus } | { ok: false; error: 'upstream' };

export * from './survey';
export * from './snapshot';
export * from './result-code';
export * from './validate';
export * from './regions';
export * from './scoring';
