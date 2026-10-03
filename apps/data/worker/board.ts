// 看板汇总：把每份问卷判成「环境干净 / 有问题 / 无法判定」「行为干净 / 有违规项 / 无法判定」，再按维度数份数。
// 规则与 docs/specs/board.md「环境判定」「行为判定」一致，改规则先改 spec；只在服务器上跑，下发的只有份数
import {
  ACCOUNT_SOURCE,
  ACCOUNTS_IN_ENV,
  BAN_AFTER,
  BAN_REASON,
  CARD_KIND,
  CLIENT,
  CN_CLIENT,
  DISTILL,
  ENV_BAN_HISTORY,
  JAILBREAK,
  LOGIN_METHOD,
  NODE_SWITCH,
  PHONE_VERIFY,
  PLAN,
  REVERSE_PROXY,
  SENSITIVE_USE,
  SHARING,
  SUPPORTED_COUNTRIES,
  SYSTEM_LANGUAGE,
  TIMEZONE_SETTING,
  USAGE_CAP,
  type AccountStatus,
  type CardInfo,
  type CheckId,
  type DetectSnapshot,
  type ManagedSubmission,
  type Status,
  type SurveyAnswers,
} from '@claude-analysis/shared';
import type { BoardData, BoardDim, BoardGroup, BoardRow, Counts, PairDim, QuadKey } from '../src/lib/board';

export interface Sub {
  answers: SurveyAnswers;
  env: ManagedSubmission['env'];
  snapshot: DetectSnapshot | null;
}

type Tri = 'clean' | 'problem' | 'unknown';

/** 任一项有问题即有问题；否则任一项无法判定即无法判定 */
const combine = (parts: Tri[]): Tri => (parts.includes('problem') ? 'problem' : parts.includes('unknown') ? 'unknown' : 'clean');

/** 网络类：没有「异常」即可 */
const NETWORK_CHECKS: CheckId[] = [
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
/** 设备指纹类：要求全部「正常」（这类最多判到「注意」） */
const FP_CHECKS: CheckId[] = ['fp.timezone', 'fp.language', 'fp.locale', 'fp.fonts', 'fp.browser', 'fp.device', 'cross.timezone', 'cross.language'];

/** 数据清洗「检测设备不是使用设备」：检测时的系统不在 E2 里，设备指纹不代表实际用 Claude 的设备 */
const fpUsable = (s: Sub) => !s.snapshot || s.snapshot.local.fp.os === 'other' || s.answers.os.includes(s.snapshot.local.fp.os);

export function envOf(s: Sub): Tri {
  const parts: Tri[] = [];
  // 别的号被封过：这套环境可能已被关联；「不清楚」跳过
  if (s.answers.envBanHistory === 'yes') parts.push('problem');
  if (s.snapshot) {
    // 「未知」的检测项跳过
    const st = s.snapshot.local.status;
    if (NETWORK_CHECKS.some((id) => st[id] === 'bad')) parts.push('problem');
    if (!fpUsable(s)) parts.push('unknown');
    else if (FP_CHECKS.some((id) => st[id] === 'warn' || st[id] === 'bad')) parts.push('problem');
  } else if (s.env.source === 'manual') {
    const m = s.env.answers;
    parts.push(m.exitRegion === null ? 'unknown' : SUPPORTED_COUNTRIES.has(m.exitRegion) ? 'clean' : 'problem');
    parts.push(m.timezone === 'match_exit' ? 'clean' : m.timezone === 'unknown' ? 'unknown' : 'problem');
    parts.push(m.language === 'zh' ? 'problem' : 'clean');
    parts.push(m.nodeSwitch === 'fixed' ? 'clean' : m.nodeSwitch === 'auto' ? 'problem' : 'unknown');
    parts.push(m.cnClient === 'no' ? 'clean' : m.cnClient === 'yes' ? 'problem' : 'unknown');
  }
  return combine(parts);
}

/** 违规项：买号或拼车、多人共用、反代、破限、蒸馏；没问到的题（第 1 版没有 E8）跳过 */
export function behaviorOf({ answers: a }: Sub): Tri {
  const parts: Tri[] = [
    a.source === 'bought' || a.source === 'shared' ? 'problem' : 'clean',
    a.sharing === 'multi_user' ? 'problem' : 'clean',
    a.reverseProxy.includes('none') ? 'clean' : 'problem',
    a.jailbreak === 'never' ? 'clean' : a.jailbreak === 'decline' ? 'unknown' : 'problem',
  ];
  if (a.distill) parts.push(a.distill === 'no' ? 'clean' : a.distill === 'decline' ? 'unknown' : 'problem');
  return combine(parts);
}

// ---------- 维度 ----------

const zero = (): Counts => ({ banned: 0, restored: 0, active: 0 });
const add = (c: Counts, status: AccountStatus) => {
  c[status === 'banned' ? 'banned' : status === 'restored' ? 'restored' : 'active']++;
};

interface DimDef {
  q: string;
  title: string;
  /** 选项与显示顺序；country 维度为空，按份数排 */
  labels: Record<string, string>;
  /** 这份问卷选了哪些选项；没问到 / 不适用返回 null */
  pick: (s: Sub) => string[] | null;
  multi?: boolean;
  country?: boolean;
}

const one = (v: string | undefined | null) => (v ? [v] : null);

/** 检测项按判定结果分组；设备指纹类遇到「检测设备不是使用设备」不计入 */
function checkDim(title: string, ids: CheckId[], labels: Partial<Record<Status, string>>, fingerprint = false): DimDef {
  const rank: Record<Status, number> = { unknown: 0, ok: 1, warn: 2, bad: 3 };
  return {
    q: '检测',
    title,
    labels: labels as Record<string, string>,
    pick: (s) => {
      if (!s.snapshot || (fingerprint && !fpUsable(s))) return null;
      // 几项合成一个维度时取最严重的；全是「未知」不计入
      const worst = ids.map((id) => s.snapshot!.local.status[id]).reduce<Status | undefined>((a, b) => (b && (!a || rank[b] > rank[a]) ? b : a), undefined);
      return worst && worst !== 'unknown' ? [worst] : null;
    },
  };
}

const manual = (s: Sub) => (s.env.source === 'manual' ? s.env.answers : null);
const cardOf = (s: Sub): CardInfo | null => {
  const p = s.answers.payment;
  if (p?.method === 'card') return p.card;
  if (p?.method === 'google_play' && p.via.kind !== 'other') return p.via as CardInfo;
  return null;
};

const EXIT_SHORT = { airport: '机场', vps: '自建 VPS', static: '静态 IP', vpn: '商业 VPN', mobile_roaming: '境外手机卡流量', abroad: '人在海外', unknown: '不清楚' };

const BEHAVIOR: Array<{ title: string; desc: string; dims: DimDef[] }> = [
  {
    title: '违规项',
    desc: '判定「行为干净」用的 5 题',
    dims: [
      { q: 'C1', title: '账号来源', labels: ACCOUNT_SOURCE, pick: (s) => [s.answers.source] },
      { q: 'E5', title: '谁在用', labels: SHARING, pick: (s) => [s.answers.sharing] },
      { q: 'E6', title: '逆向或反代', labels: REVERSE_PROXY, pick: (s) => s.answers.reverseProxy, multi: true },
      { q: 'E7', title: '破限或 NSFW', labels: JAILBREAK, pick: (s) => [s.answers.jailbreak] },
      { q: 'E8', title: '蒸馏', labels: DISTILL, pick: (s) => one(s.answers.distill) },
    ],
  },
  {
    title: '异常行为',
    desc: '单独标记，不算违规项',
    dims: [
      { q: 'C8', title: '同环境账号数', labels: ACCOUNTS_IN_ENV, pick: (s) => [s.answers.accountsInEnv] },
      {
        q: 'C6',
        title: '代充',
        labels: { reseller: '代充', other: '其他付款方式或 Free' },
        pick: (s) => [s.answers.payment?.method === 'reseller' ? 'reseller' : 'other'],
      },
    ],
  },
  {
    title: '用法与用途',
    desc: '不进判定，只做比较',
    dims: [
      { q: 'E3', title: '用量上限', labels: USAGE_CAP, pick: (s) => [s.answers.usageCap] },
      { q: 'C5', title: '订阅', labels: PLAN, pick: (s) => [s.answers.plan] },
      { q: 'E1', title: '客户端', labels: CLIENT, pick: (s) => s.answers.clients, multi: true },
      { q: 'E9', title: '用途', labels: SENSITIVE_USE, pick: (s) => s.answers.sensitiveUse ?? null, multi: true },
    ],
  },
];

const ENVIRONMENT: Array<{ title: string; desc?: string; dims: DimDef[] }> = [
  {
    title: '网络',
    desc: '代理情况两类样本都有；检测项只有检测站样本，M 开头的只有手动填写的样本',
    dims: [
      { q: 'D2', title: '代理情况', labels: EXIT_SHORT, pick: (s) => [s.env.exitType] },
      checkDim('出口地区', ['ip.region'], { ok: '支持地区', bad: '不支持地区' }),
      checkDim('IP 网络类型', ['ip.type'], { ok: '非机房（住宅、移动等）', warn: '机房，或数据源有分歧' }),
      checkDim('原生 IP', ['ip.native'], { ok: '原生 IP', warn: '广播 IP' }),
      checkDim('VPN / 代理标记', ['ip.vpn', 'ip.proxy'], { ok: '未标记', warn: '只有一家标记', bad: '都标记' }),
      checkDim('风险分', ['ip.score'], { ok: '低风险', warn: '中风险', bad: '高风险' }),
      checkDim('多域名出口', ['exit.consistency'], { ok: '一致', warn: '部分域名请求失败', bad: '出现多个出口' }),
      checkDim('IP 漂移', ['exit.drift'], { ok: '没有漂移', bad: '几秒内 IP 变化' }),
      checkDim('WebRTC', ['leak.webrtc'], { ok: '未泄露或已禁用', warn: 'UDP 出口与 Claude 不同', bad: '泄露大陆 IP' }),
      checkDim('DNS 解析器', ['leak.dns'], { ok: '未发现国内解析器', warn: '有港澳解析器', bad: '有国内解析器' }),
      {
        q: 'M1',
        title: '出口地区',
        labels: { supported: '支持地区', unsupported: '不支持地区', unknown: '不清楚' },
        pick: (s) => {
          const m = manual(s);
          if (!m) return null;
          return [m.exitRegion === null ? 'unknown' : SUPPORTED_COUNTRIES.has(m.exitRegion) ? 'supported' : 'unsupported'];
        },
      },
      { q: 'M5', title: '节点自动切换', labels: NODE_SWITCH, pick: (s) => one(manual(s)?.nodeSwitch) },
    ],
  },
  {
    title: '设备指纹',
    desc: '检测设备不是使用设备的检测站样本不计入',
    dims: [
      checkDim('系统时区', ['fp.timezone'], { ok: '非中国 / 港澳时区', warn: '中国或港澳时区' }, true),
      checkDim('浏览器语言', ['fp.language'], { ok: '不含简体中文', warn: '含简体中文或港澳中文' }, true),
      checkDim('区域格式', ['fp.locale'], { ok: '非简体中文格式', warn: '简体中文或港澳格式' }, true),
      checkDim('中文环境字体', ['fp.fonts'], { ok: '没有', warn: '有' }, true),
      checkDim('国产浏览器或设备', ['fp.browser', 'fp.device'], { ok: '未检测到', warn: '检测到' }, true),
      checkDim('时区与 IP', ['cross.timezone'], { ok: '一致', warn: '不一致' }, true),
      { q: 'M3', title: '系统时区', labels: TIMEZONE_SETTING, pick: (s) => one(manual(s)?.timezone) },
      { q: 'M4', title: '系统和浏览器语言', labels: SYSTEM_LANGUAGE, pick: (s) => one(manual(s)?.language) },
      { q: 'M6', title: '国产手机或浏览器', labels: CN_CLIENT, pick: (s) => one(manual(s)?.cnClient) },
    ],
  },
  {
    title: '身份地区信号',
    dims: [
      { q: 'C4', title: '手机号验证', labels: PHONE_VERIFY, pick: (s) => [s.answers.phone] },
      { q: 'C2', title: '登录方式', labels: LOGIN_METHOD, pick: (s) => [s.answers.login] },
      { q: 'C6', title: '卡类型', labels: CARD_KIND, pick: (s) => one(cardOf(s)?.kind) },
      { q: 'C6', title: '发卡地区', labels: {}, country: true, pick: (s) => one(cardOf(s)?.region) },
      {
        q: 'C6',
        title: 'Apple ID 所在区',
        labels: {},
        country: true,
        pick: (s) => (s.answers.payment?.method === 'app_store' ? [s.answers.payment.region] : null),
      },
    ],
  },
  {
    title: '关联',
    dims: [{ q: 'C9', title: '同环境别的号被封过', labels: ENV_BAN_HISTORY, pick: (s) => [s.answers.envBanHistory] }],
  },
];

/** 低频取值（国家）少于这个份数合并为「其他」 */
const RARE = 5;

function countDim(def: DimDef, subs: Sub[]): BoardDim | null {
  const counts = new Map<string, Counts>();
  for (const s of subs) {
    for (const k of def.pick(s) ?? []) {
      if (!counts.has(k)) counts.set(k, zero());
      add(counts.get(k)!, s.answers.status);
    }
  }
  if (!counts.size) return null;
  const n = (c: Counts) => c.banned + c.restored + c.active;
  let rows: BoardRow[];
  if (def.country) {
    const other = zero();
    rows = [];
    for (const [k, c] of [...counts].sort((a, b) => n(b[1]) - n(a[1]))) {
      if (n(c) >= RARE) rows.push({ key: k, label: k, c });
      else (['banned', 'restored', 'active'] as const).forEach((f) => (other[f] += c[f]));
    }
    if (n(other)) rows.push({ key: 'other', label: '其他', c: other });
  } else {
    rows = Object.entries(def.labels).flatMap(([k, label]) => (counts.has(k) ? [{ key: k, label, c: counts.get(k)! }] : []));
  }
  return { q: def.q, title: def.title, multi: def.multi, country: def.country, rows };
}

function section(defs: Array<{ title: string; desc?: string; dims: DimDef[] }>, subs: Sub[]) {
  const t = zero();
  subs.forEach((s) => add(t, s.answers.status));
  const groups: BoardGroup[] = defs.flatMap((g) => {
    const dims = g.dims.flatMap((d) => countDim(d, subs) ?? []);
    return dims.length ? [{ title: g.title, desc: g.desc, dims }] : [];
  });
  return { total: t, groups };
}

function months(from: string, to: string): string[] {
  const list: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    list.push(`${y}-${String(m).padStart(2, '0')}`);
    m === 12 ? ((y += 1), (m = 1)) : (m += 1);
  }
  return list;
}

export function buildBoard(subs: Sub[], today: string): BoardData {
  const env = subs.map(envOf);
  const beh = subs.map(behaviorOf);

  const quad: Record<QuadKey, Counts> = { cc: zero(), cv: zero(), pc: zero(), pv: zero() };
  let undetermined = 0;
  subs.forEach((s, i) => {
    if (env[i] === 'unknown' || beh[i] === 'unknown') return void undetermined++;
    add(quad[`${env[i] === 'clean' ? 'c' : 'p'}${beh[i] === 'clean' ? 'c' : 'v'}` as QuadKey], s.answers.status);
  });

  const envClean = subs.filter((_, i) => env[i] === 'clean');
  const behClean = subs.filter((_, i) => beh[i] === 'clean');

  // 封禁时间线：被封过的账号按封禁月份
  const bannedIdx = subs.flatMap((s, i) => (s.answers.status !== 'active' && s.answers.bannedAt ? [i] : []));
  const banned = bannedIdx.map((i) => subs[i]);
  const byMonth = new Map<string, { banned: number; restored: number }>();
  for (const s of banned) {
    const m = s.answers.bannedAt!.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, { banned: 0, restored: 0 });
    byMonth.get(m)![s.answers.status === 'restored' ? 'restored' : 'banned']++;
  }
  const keys = [...byMonth.keys()].sort();
  const timeline = keys.length ? months(keys[0], keys.at(-1)!).map((month) => ({ month, ...(byMonth.get(month) ?? { banned: 0, restored: 0 }) })) : [];

  // 被封过的账号按环境分两组
  const pair = (q: string, title: string, labels: Record<string, string>, pick: (a: SurveyAnswers) => string | undefined): PairDim => {
    // 看板上列窄，去掉选项里括号补充的英文
    const rows = Object.entries(labels).map(([key, label]) => ({ key, label: label.replace(/（.*）$/, ''), clean: zero(), problem: zero() }));
    bannedIdx.forEach((i) => {
      const s = subs[i], e = env[i];
      const row = rows.find((r) => r.key === pick(s.answers));
      if (row && e !== 'unknown') add(row[e === 'clean' ? 'clean' : 'problem'], s.answers.status);
    });
    return { q, title, rows: rows.filter((r) => r.clean.banned + r.clean.restored + r.problem.banned + r.problem.restored) };
  };

  return {
    updatedOn: today,
    total: subs.length,
    detect: subs.filter((s) => s.env.source === 'detect').length,
    quad,
    undetermined,
    behavior: { scoped: section(BEHAVIOR, envClean), all: section(BEHAVIOR, subs) },
    environment: { scoped: section(ENVIRONMENT, behClean), all: section(ENVIRONMENT, subs) },
    timeline,
    byEnv: [
      pair('B2', '使用多久后被封', BAN_AFTER, (a) => a.banAfter),
      pair('B5', '封禁通知里写的原因', BAN_REASON, (a) => a.banReason),
    ],
  };
}
