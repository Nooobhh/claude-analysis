// 问卷字段：值是英文 key（入库 / 公开数据用），标签是中文（表单 / 看板用）。
// 题目文案、显示条件、校验规则见 docs/specs/survey.md

export const SURVEY_VERSION = 3;
/** 服务器接受的问卷版本：后一版只新增题（第 2 版 B5、E8、E9，第 3 版 E10），旧版问卷缺这些题照样有效 */
export const SURVEY_VERSIONS = [1, 2, 3] as const;
export type SurveyVersion = (typeof SURVEY_VERSIONS)[number];

/** ISO 3166-1 alpha-2，大写 */
export type CountryCode = string;
/** YYYY-MM */
export type YearMonth = string;
/** YYYY-MM，或精确到日的 YYYY-MM-DD */
export type ApproxDate = string;

// ---------- A 账号状态 ----------

export const ACCOUNT_STATUS = {
  active: '正常使用',
  banned: '已被封禁',
  restored: '被封后申诉恢复',
} as const;
export type AccountStatus = keyof typeof ACCOUNT_STATUS;

// ---------- B 封禁详情 ----------

export const BAN_AFTER = {
  signup: '注册当场',
  within_1d: '24 小时内',
  within_1w: '1–7 天',
  within_1m: '1–4 周',
  within_3m: '1–3 月',
  over_3m: '3 月以上',
  unknown: '不清楚',
} as const;
export type BanAfter = keyof typeof BAN_AFTER;

/** 多选；none 与其他选项互斥 */
export const BAN_TRIGGER = {
  signup: '刚注册',
  payment: '刚付款订阅',
  kyc: '刚通过 KYC 身份验证',
  node_switch: '刚换节点或地区',
  new_device: '新设备登录',
  heavy_code: '高强度用 Claude Code',
  reverse_proxy: '进行过反代',
  other: '其他',
  none: '没有明显事件',
} as const;
export type BanTrigger = keyof typeof BAN_TRIGGER;

/** 0.4.0 上线后改掉的旧选项「不清楚」（当时与其他项互斥）：早期问卷里还存着。重新校验时接受，新问卷不再提供，库里原样不改 */
export const LEGACY_BAN_TRIGGER = { unknown: '不清楚' } as const;
export type LegacyBanTrigger = keyof typeof LEGACY_BAN_TRIGGER;

/** 只问仍在封禁的账号；restored 即申诉成功 */
export const APPEAL = {
  none: '没申诉',
  pending: '申诉中',
  rejected: '被拒',
  unavailable: '无法申诉',
} as const;
export type Appeal = keyof typeof APPEAL;

/** 第 2 版新增；被封过的账号问 */
export const BAN_REASON = {
  usage_policy: '违反使用政策（Usage Policy）',
  terms: '违反服务条款（Terms of Service）',
  region: '不支持的地区',
  payment: '付款问题',
  unspecified: '通知里没写具体原因',
  no_notice: '没收到通知',
  forgot: '不记得',
} as const;
export type BanReason = keyof typeof BAN_REASON;

// ---------- C 账号来历 ----------

export const ACCOUNT_SOURCE = {
  self: '自己注册',
  bought: '买的成品号',
  shared: '别人共享（拼车）',
  org: '公司分配',
} as const;
export type AccountSource = keyof typeof ACCOUNT_SOURCE;

export const LOGIN_METHOD = {
  google: 'Google',
  email: '邮箱',
  apple: 'Apple',
} as const;
export type LoginMethod = keyof typeof LOGIN_METHOD;

export const EMAIL_TYPE = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  icloud: 'iCloud',
  other: '其他',
} as const;
export type EmailType = keyof typeof EMAIL_TYPE;

export const PHONE_VERIFY = {
  physical: '海外实体卡',
  virtual: '海外虚拟号（Google Voice 等）',
  sms_service: '接码平台',
  not_required: '没被要求验证',
  unknown: '不清楚',
} as const;
export type PhoneVerify = keyof typeof PHONE_VERIFY;

export const PLAN = {
  free: 'Free',
  pro: 'Pro',
  max5x: 'Max 5x',
  max20x: 'Max 20x',
  team: 'Team 或 Enterprise',
  api: '只用 API',
} as const;
export type Plan = keyof typeof PLAN;

export const PAYMENT_METHOD = {
  card: '银行卡直接支付',
  app_store: 'App Store 订阅',
  google_play: 'Google Play 订阅',
  reseller: '代充',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD;

export const CARD_KIND = {
  physical: '实体卡',
  virtual: '虚拟卡',
} as const;
export type CardKind = keyof typeof CARD_KIND;

export interface CardInfo {
  kind: CardKind;
  /** 卡号前 6 位，选填 */
  bin?: string;
  /** 发卡地区，选填（不想填卡头可以只填这个） */
  region?: CountryCode;
}

export type Payment =
  | { method: 'card'; card: CardInfo }
  /** Apple ID 所在区 */
  | { method: 'app_store'; region: CountryCode }
  /** Google Play 背后实际怎么付的；其他方式可选填一句说明 */
  | { method: 'google_play'; via: CardInfo | { kind: 'other'; note?: string } }
  | { method: 'reseller' };

export const REFUND = {
  full: '全额',
  partial: '部分',
  none: '没退',
} as const;
export type Refund = keyof typeof REFUND;

export const ACCOUNTS_IN_ENV = {
  one: '1 个',
  few: '2–3 个',
  many: '4 个以上',
} as const;
export type AccountsInEnv = keyof typeof ACCOUNTS_IN_ENV;

export const ENV_BAN_HISTORY = {
  yes: '有',
  no: '没有',
  unknown: '不清楚',
} as const;
export type EnvBanHistory = keyof typeof ENV_BAN_HISTORY;

// ---------- D 网络环境 ----------

/** 两条路径都问：检测站只能看到 IP 数据库的归类，看不出 IP 是从哪来的 */
export const EXIT_TYPE = {
  airport: '机场（订阅制代理，多人共用节点）',
  vps: '自建 VPS（自己租服务器搭）',
  /** 只看是否独享、固定；是家宽还是机房 IP 用户判断不准，交给检测数据 */
  static: '静态 IP（单独购买、自己独享的固定 IP，机场或 IP 服务商出售的都算）',
  vpn: '商业 VPN（ExpressVPN、NordVPN 等独立 App）',
  mobile_roaming: '境外手机卡流量（漫游或 eSIM）',
  abroad: '人在海外，不用代理',
  unknown: '不清楚',
} as const;
export type ExitType = keyof typeof EXIT_TYPE;

/** 「静态住宅 IP」（residential）0.4.0 上线后改名「静态 IP」（static），是同一个选项：读早期问卷时换成新的，库里原样不改 */
export const normalizeExitType = (v: string): ExitType => (v === 'residential' ? 'static' : (v as ExitType));

// 以下只在手动填写路径问

export const PROXY_MODE = {
  rule: '规则分流',
  global: '全局',
  tun: 'TUN 虚拟网卡',
  router: '软路由',
  unknown: '不清楚',
} as const;
export type ProxyMode = keyof typeof PROXY_MODE;

export const TIMEZONE_SETTING = {
  cn: '中国时区',
  match_exit: '和出口地区一致',
  other: '其他',
  unknown: '不清楚',
} as const;
export type TimezoneSetting = keyof typeof TIMEZONE_SETTING;

export const SYSTEM_LANGUAGE = {
  zh: '中文',
  en: '英文',
  other: '其他',
} as const;
export type SystemLanguage = keyof typeof SYSTEM_LANGUAGE;

/** 对应检测站的「IP 漂移」 */
export const NODE_SWITCH = {
  fixed: '固定用一个',
  auto: '会自动切换（负载均衡、自动选最快节点等）',
  unknown: '不清楚',
} as const;
export type NodeSwitch = keyof typeof NODE_SWITCH;

/** 对应检测站的「国产浏览器 / 设备」 */
export const CN_CLIENT = {
  yes: '有',
  no: '没有',
  unknown: '不清楚',
} as const;
export type CnClient = keyof typeof CN_CLIENT;

export interface ManualEnv {
  /** null = 不清楚 */
  exitRegion: CountryCode | null;
  /** 代理情况 = abroad 时不问 */
  proxyMode?: ProxyMode;
  timezone: TimezoneSetting;
  language: SystemLanguage;
  nodeSwitch: NodeSwitch;
  cnClient: CnClient;
}

/** 与现在的环境一致时可选检测站带入（结果码），不一致只能手动填；代理情况两条路径都问 */
export type SurveyEnv =
  | { same: true; exitType: ExitType; source: 'detect'; token: string }
  | { same: boolean; exitType: ExitType; source: 'manual'; answers: ManualEnv };

// ---------- E 使用习惯 ----------

export const CLIENT = {
  web: '网页',
  desktop: '桌面 App',
  ios: 'iOS App',
  android: '安卓 App',
  claude_code: 'Claude Code',
  api: 'API',
} as const;
export type Client = keyof typeof CLIENT;

export const OS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
  android: '安卓',
} as const;
export type Os = keyof typeof OS;

export const USAGE_CAP = {
  often: '经常用满',
  sometimes: '偶尔用满',
  never: '从没用满',
} as const;
export type UsageCap = keyof typeof USAGE_CAP;

export const CHAT_LANGUAGE = {
  zh: '中文',
  en: '英文',
  mixed: '混合',
} as const;
export type ChatLanguage = keyof typeof CHAT_LANGUAGE;

export const SHARING = {
  solo_single: '本人一台设备',
  solo_multi: '本人多台设备',
  multi_user: '多人共用',
} as const;
export type Sharing = keyof typeof SHARING;

/** 多选；none 与其他选项互斥 */
export const REVERSE_PROXY = {
  none: '没有',
  cpa: 'CPA',
  other: '其他逆向或反代软件',
} as const;
export type ReverseProxy = keyof typeof REVERSE_PROXY;

export const JAILBREAK = {
  never: '从不',
  sometimes: '偶尔',
  often: '经常',
  decline: '不便回答',
} as const;
export type Jailbreak = keyof typeof JAILBREAK;

/** 第 2 版新增 */
export const DISTILL = {
  no: '没有',
  yes: '有',
  decline: '不便回答',
} as const;
export type Distill = keyof typeof DISTILL;

/** 第 2 版新增；多选，none、decline 与其他选项互斥 */
export const SENSITIVE_USE = {
  security: '网络安全（渗透、漏洞、攻防）',
  bulk: '批量生成内容',
  automation: '自动化脚本或爬虫',
  none: '都没有',
  decline: '不便回答',
} as const;
export type SensitiveUse = keyof typeof SENSITIVE_USE;

/** 第 3 版新增；多选，none、decline 与其他选项互斥 */
export const SENSITIVE_TOPIC = {
  frontier_tech: '国产芯片、军工等高精尖技术研究',
  public_safety: '恐怖主义、武器、暴力等危害社会安全的话题',
  none: '都没有',
  decline: '不便回答',
} as const;
export type SensitiveTopic = keyof typeof SENSITIVE_TOPIC;

// ---------- 汇总 ----------

/** 自由文本长度上限（表单 maxlength 与服务端校验共用） */
export const TEXT_LIMITS = {
  emailDomain: 253,
  paymentNote: 50,
  note: 500,
} as const;

/** 一份问卷 = 一个 Claude 账号；可选字段的出现条件见 spec */
export interface SurveyAnswers {
  // A 账号状态
  status: AccountStatus;
  /** null = 不清楚（买来或共享的账号） */
  registeredAt: YearMonth | null;

  // B 封禁详情：status ≠ active 时必填（appeal 只在 banned 时）
  bannedAt?: ApproxDate;
  banAfter?: BanAfter;
  /** 早期问卷可能有旧选项 LEGACY_BAN_TRIGGER */
  banTriggers?: Array<BanTrigger | LegacyBanTrigger>;
  appeal?: Appeal;
  /** 第 2 版新增；status ≠ active 时问 */
  banReason?: BanReason;

  // C 账号来历
  source: AccountSource;
  login: LoginMethod;
  /** login = email 时必填 */
  emailType?: EmailType;
  /** emailType = other 时选填，小写域名 */
  emailDomain?: string;
  phone: PhoneVerify;
  plan: Plan;
  /** plan ≠ free 时必填 */
  payment?: Payment;
  /** plan ≠ free 且 status ≠ active 时必填 */
  refund?: Refund;
  accountsInEnv: AccountsInEnv;
  envBanHistory: EnvBanHistory;

  // E 使用习惯
  clients: Client[];
  os: Os[];
  usageCap: UsageCap;
  chatLanguage: ChatLanguage;
  sharing: Sharing;
  reverseProxy: ReverseProxy[];
  jailbreak: Jailbreak;
  /** 第 2 版新增；第 1 版问卷可能没有 */
  distill?: Distill;
  /** 第 2 版新增；第 1 版问卷可能没有 */
  sensitiveUse?: SensitiveUse[];
  /** 第 3 版新增；第 1、2 版问卷可能没有 */
  sensitiveTopic?: SensitiveTopic[];

  // F 补充（选填）
  note?: string;
}

/** 提交到数据站的完整内容 */
export interface SurveySubmission {
  v: SurveyVersion;
  answers: SurveyAnswers;
  /** D 网络环境 */
  env: SurveyEnv;
}

/** POST /api/submissions 的返回；key = 管理链接密钥，只返回这一次，服务器只存它的哈希 */
export type SubmitError =
  | 'bad_request'
  | 'invalid'
  | 'code_format'
  | 'code_signature'
  | 'code_expired'
  | 'code_used'
  | 'server';
export type SubmitResponse = { ok: true; key: string } | { ok: false; error: SubmitError; field?: string };

/** 管理链接能改的字段：账号状态，以及随状态出现的封禁详情与退款 */
export const STATUS_FIELDS = ['status', 'bannedAt', 'banAfter', 'banTriggers', 'appeal', 'banReason', 'refund'] as const;
export type StatusUpdate = Pick<SurveyAnswers, (typeof STATUS_FIELDS)[number]>;

/** 旧版问卷可以补答的新题（B5 随状态一起改，不在这里）；只能填空，不能改已答的 */
export const SUPPLEMENT_FIELDS = ['distill', 'sensitiveUse', 'sensitiveTopic'] as const;
export type SupplementUpdate = Pick<SurveyAnswers, (typeof SUPPLEMENT_FIELDS)[number]>;
/** PATCH /api/submission 的补答请求；不带 supplement 的请求是更新状态（StatusUpdate） */
export type SupplementRequest = { supplement: SupplementUpdate };

/** 还没答的新题：问卷页据此提示可以补充 */
export function unansweredNew(a: SurveyAnswers): Array<'banReason' | (typeof SUPPLEMENT_FIELDS)[number]> {
  const list: Array<'banReason' | (typeof SUPPLEMENT_FIELDS)[number]> = [];
  if (a.status !== 'active' && !a.banReason) list.push('banReason');
  for (const f of SUPPLEMENT_FIELDS) if (a[f] === undefined) list.push(f);
  return list;
}

/** GET / PATCH /api/submission 返回的问卷（凭管理密钥） */
export interface ManagedSubmission {
  /** 提交时的问卷版本 */
  v: SurveyVersion;
  answers: SurveyAnswers;
  /** 入库的网络环境：不含结果码原文 */
  env: { same: true; exitType: ExitType; source: 'detect' } | Extract<SurveyEnv, { source: 'manual' }>;
  createdOn: string;
  updatedOn: string;
  /** 状态变化记录，按时间先后 */
  events: Array<{ status: AccountStatus; onDate: string }>;
}

export type ManageError = 'not_found' | 'bad_request' | 'invalid' | 'server';
export type ManageResponse = { ok: true; submission: ManagedSubmission } | { ok: false; error: ManageError; field?: string };
/** DELETE /api/submission 的返回 */
export type DeleteResponse = { ok: true } | { ok: false; error: ManageError };

/** GET /api/stats：已收集的问卷份数（问卷页标题下显示） */
export type StatsResponse = { ok: true; total: number } | { ok: false; error: 'server' };
