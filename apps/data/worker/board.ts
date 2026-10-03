// 看板汇总：把每份问卷判成「环境干净 / 有问题 / 无法判定」「行为干净 / 有违规项 / 无法判定」（用于散点图），
// 再按账号情况 / 网络环境 / 使用习惯三块数份数。规则与 docs/specs/board.md 一致，改规则先改 spec；
// 网络环境、设备指纹的扣分规则在 shared scoring.ts，与检测站结论卡共用。只在服务器上跑，下发的只有份数
import {
  ACCOUNT_SOURCE,
  ACCOUNTS_IN_ENV,
  APPEAL,
  BAN_AFTER,
  BAN_REASON,
  BAN_TRIGGER,
  CARD_KIND,
  CHAT_LANGUAGE,
  EMAIL_TYPE,
  ENV_BAN_HISTORY,
  ENV_PASS_SCORE,
  LEGACY_BAN_TRIGGER,
  LOGIN_METHOD,
  PAYMENT_METHOD,
  PHONE_VERIFY,
  PLAN,
  REFUND,
  SHARING,
  SUPPORTED_COUNTRIES,
  USAGE_CAP,
  ZH_SPEAKING,
  judgeFingerprint,
  judgeNetwork,
  type AccountStatus,
  type CardInfo,
  type CheckId,
  type DetectSnapshot,
  type EnvVerdict,
  type ManagedSubmission,
  type ManualEnv,
  type SurveyAnswers,
} from '@claude-analysis/shared';
import type { BoardData, BoardDim, BoardGroup, BoardPart, BoardRow, Counts, PairDim, QuadKey } from '../src/lib/board';

export interface Sub {
  answers: SurveyAnswers;
  env: ManagedSubmission['env'];
  snapshot: DetectSnapshot | null;
}

type Tri = 'clean' | 'problem' | 'unknown';

/** 任一项有问题即有问题；否则任一项无法判定即无法判定 */
const combine = (parts: Tri[]): Tri => (parts.includes('problem') ? 'problem' : parts.includes('unknown') ? 'unknown' : 'clean');
const triOf = (v: EnvVerdict): Tri => (v.unknown ? 'unknown' : v.pass ? 'clean' : 'problem');

/** 数据清洗「检测设备不是使用设备」：检测时的系统不在 E2 里，设备指纹不代表实际用 Claude 的设备 */
const fpUsable = (s: Sub) => !s.snapshot || s.snapshot.local.fp.os === 'other' || s.answers.os.includes(s.snapshot.local.fp.os);
const manual = (s: Sub): ManualEnv | null => (s.env.source === 'manual' ? s.env.answers : null);

/** 网络环境：检测站样本按 scoring.ts；手动样本出口在不支持地区、节点会自动切换直接不通过，出口不清楚无法判定 */
export function networkOf(s: Sub): Tri {
  if (s.snapshot) return triOf(judgeNetwork(s.snapshot.local.status));
  const m = manual(s);
  if (!m) return 'unknown';
  if ((m.exitRegion !== null && !SUPPORTED_COUNTRIES.has(m.exitRegion)) || m.nodeSwitch === 'auto') return 'problem';
  return m.exitRegion === null ? 'unknown' : 'clean';
}

/** 手动样本的设备指纹扣分（与检测站对应项的权重折算，见 spec）；「不清楚」跳过 */
const manualFpPoints = (m: ManualEnv) =>
  (m.timezone === 'cn' ? 60 : m.timezone === 'other' ? 20 : 0) + (m.language === 'zh' ? 20 : 0) + (m.cnClient === 'yes' ? 30 : 0);

export function fingerprintOf(s: Sub): Tri {
  if (s.snapshot) return fpUsable(s) ? triOf(judgeFingerprint(s.snapshot.local.status)) : 'unknown';
  const m = manual(s);
  if (!m) return 'unknown';
  return 100 - manualFpPoints(m) < ENV_PASS_SCORE ? 'problem' : 'clean';
}

/** 环境干净 = 网络环境、设备指纹都通过；账号、支付相关的题只在账号情况里展示，不进判定 */
export const envOf = (s: Sub): Tri => combine([networkOf(s), fingerprintOf(s)]);

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
  /** 选项与显示顺序；country / ordered 维度为空 */
  labels: Record<string, string>;
  /** 这份问卷选了哪些选项；没问到 / 不适用 / 不计入返回 null */
  pick: (s: Sub) => string[] | null;
  multi?: boolean;
  /** 选项是国家代码：按份数排，少于 RARE 份合并为「其他」 */
  country?: boolean;
  /** 选项按 key 排序（unknown 放最后），label 由它生成 */
  ordered?: (key: string) => string;
  /** 只有被封的账号答：展示分布 */
  dist?: boolean;
}

interface GroupDef {
  title: string;
  desc?: string;
  dims: DimDef[];
}

const one = (v: string | undefined | null) => (v ? [v] : null);
const statusOf = (s: Sub, id: CheckId) => s.snapshot?.local.status[id];
const cardOf = (s: Sub): CardInfo | null => {
  const p = s.answers.payment;
  if (p?.method === 'card') return p.card;
  if (p?.method === 'google_play' && p.via.kind !== 'other') return p.via as CardInfo;
  return null;
};

const EXIT_SHORT = { airport: '机场', vps: '自建 VPS', static: '静态 IP', vpn: '商业 VPN', mobile_roaming: '境外手机卡流量', abroad: '人在海外', unknown: '不清楚' };

// ---------- 账号情况（A+B+C）：全部样本 ----------

/** 注册时间按年；不清楚单列 */
const yearOf = (ym: string | null) => (ym ? ym.slice(0, 4) : 'unknown');

const ACCOUNT: GroupDef[] = [
  {
    title: '注册',
    dims: [
      {
        q: 'A2',
        title: '注册时间',
        labels: {},
        ordered: (k) => (k === 'unknown' ? '不清楚' : `${k} 年`),
        pick: (s) => [yearOf(s.answers.registeredAt)],
      },
    ],
  },
  {
    title: '账号来历',
    dims: [
      { q: 'C1', title: '账号来源', labels: ACCOUNT_SOURCE, pick: (s) => [s.answers.source] },
      { q: 'C2', title: '登录方式', labels: LOGIN_METHOD, pick: (s) => [s.answers.login] },
      { q: 'C3', title: '邮箱类型', labels: EMAIL_TYPE, pick: (s) => one(s.answers.emailType) },
      { q: 'C4', title: '手机号验证', labels: PHONE_VERIFY, pick: (s) => [s.answers.phone] },
      { q: 'C5', title: '订阅', labels: PLAN, pick: (s) => [s.answers.plan] },
      { q: 'C6', title: '付款方式', labels: { ...PAYMENT_METHOD, free: 'Free（没付款）' }, pick: (s) => [s.answers.payment?.method ?? 'free'] },
      { q: 'C6', title: '卡类型', labels: CARD_KIND, pick: (s) => one(cardOf(s)?.kind) },
      { q: 'C6', title: '发卡地区', labels: {}, country: true, pick: (s) => one(cardOf(s)?.region) },
      {
        q: 'C6',
        title: 'Apple ID 所在区',
        labels: {},
        country: true,
        pick: (s) => (s.answers.payment?.method === 'app_store' ? [s.answers.payment.region] : null),
      },
      { q: 'C8', title: '同环境账号数', labels: ACCOUNTS_IN_ENV, pick: (s) => [s.answers.accountsInEnv] },
      { q: 'C9', title: '同环境别的号被封过', labels: ENV_BAN_HISTORY, pick: (s) => [s.answers.envBanHistory] },
    ],
  },
];

/** 只有被封的账号答的题：展示分布 */
const BANNED_DISTS: DimDef[] = [
  { q: 'B3', title: '被封前后发生了什么', labels: { ...BAN_TRIGGER, ...LEGACY_BAN_TRIGGER }, multi: true, dist: true, pick: (s) => s.answers.banTriggers ?? null },
  { q: 'B4', title: '申诉', labels: APPEAL, dist: true, pick: (s) => one(s.answers.appeal) },
  { q: 'C7', title: '退款', labels: REFUND, dist: true, pick: (s) => one(s.answers.refund) },
];

// ---------- 网络环境（D）：默认行为干净 ----------

const SAME = { same: '一致', diff: '不一致' };

const NETWORK: GroupDef[] = [
  {
    title: '网络',
    desc: '标「检测」的只有检测站带入的样本',
    dims: [
      {
        q: '检测 + M5',
        title: '出口 IP 一致（各域名同一个出口、不漂移）',
        labels: SAME,
        pick: (s) => {
          if (s.snapshot) {
            const c = statusOf(s, 'exit.consistency'), d = statusOf(s, 'exit.drift');
            if (c === 'bad' || d === 'bad') return ['diff'];
            return c === 'ok' && d === 'ok' ? ['same'] : null;
          }
          const m = manual(s);
          return m?.nodeSwitch === 'fixed' ? ['same'] : m?.nodeSwitch === 'auto' ? ['diff'] : null;
        },
      },
      {
        q: '检测',
        title: '原生 IP（IP 登记地与所在地一致）',
        labels: { native: '原生 IP', broadcast: '广播 IP' },
        pick: (s) => {
          const v = statusOf(s, 'ip.native');
          return v === 'ok' ? ['native'] : v === 'warn' ? ['broadcast'] : null;
        },
      },
      { q: 'D2', title: '代理情况', labels: EXIT_SHORT, pick: (s) => [s.env.exitType] },
      {
        q: '检测',
        title: 'IP 风险标记（VPN、代理、Tor、滥用，任何一家标记都算）',
        labels: { none: '没有标记', flagged: '有标记' },
        pick: (s) => {
          const ids: CheckId[] = ['ip.vpn', 'ip.proxy', 'ip.tor', 'ip.abuser'];
          const list = ids.map((id) => statusOf(s, id)).filter((v) => v && v !== 'unknown');
          if (!list.length) return null;
          return [list.some((v) => v === 'warn' || v === 'bad') ? 'flagged' : 'none'];
        },
      },
      {
        q: '检测',
        title: '泄露',
        labels: { none: '无泄露', webrtc: 'WebRTC 泄露', dns: 'DNS 泄露' },
        multi: true,
        pick: (s) => {
          const w = statusOf(s, 'leak.webrtc'), d = statusOf(s, 'leak.dns');
          const known = (v: string | undefined) => v && v !== 'unknown';
          if (!known(w) && !known(d)) return null;
          const out = [...(w === 'warn' || w === 'bad' ? ['webrtc'] : []), ...(d === 'warn' || d === 'bad' ? ['dns'] : [])];
          return out.length ? out : ['none'];
        },
      },
    ],
  },
  {
    title: '设备指纹',
    desc: '检测设备不是使用设备的检测站样本不计入',
    dims: [
      {
        q: '检测 + M3',
        title: '时区与出口',
        labels: SAME,
        pick: (s) => {
          if (s.snapshot) {
            if (!fpUsable(s)) return null;
            const v = statusOf(s, 'cross.timezone');
            return v === 'ok' ? ['same'] : v === 'warn' ? ['diff'] : null;
          }
          const m = manual(s);
          return !m || m.timezone === 'unknown' ? null : [m.timezone === 'match_exit' ? 'same' : 'diff'];
        },
      },
      {
        q: '检测 + M4',
        title: '语言与格式与出口（中文环境、出口不在中文地区算不一致）',
        labels: SAME,
        pick: (s) => {
          if (s.snapshot) {
            if (!fpUsable(s)) return null;
            const lang = statusOf(s, 'cross.language');
            if (!lang || lang === 'unknown') return null;
            // 区域格式是简体中文、出口又不在中文地区，也算不一致
            const exit = s.snapshot.local.exitCountry;
            const zhLocale = statusOf(s, 'fp.locale') === 'warn' && !!exit && !ZH_SPEAKING.has(exit);
            return [lang === 'warn' || zhLocale ? 'diff' : 'same'];
          }
          const m = manual(s);
          if (!m) return null;
          if (m.language !== 'zh') return ['same'];
          return m.exitRegion === null ? null : [ZH_SPEAKING.has(m.exitRegion) ? 'same' : 'diff'];
        },
      },
    ],
  },
];

// ---------- 使用习惯（E）：默认环境干净 ----------

const HAS = { no: '没有', yes: '有', decline: '不便回答' };

const USAGE: GroupDef[] = [
  {
    title: '使用方式',
    dims: [
      { q: 'E1', title: '是否多客户端', labels: { single: '单一客户端', multi: '多客户端（2 个以上）' }, pick: (s) => [s.answers.clients.length > 1 ? 'multi' : 'single'] },
      { q: 'E2', title: '是否多设备', labels: { single: '单一设备系统', multi: '多设备（2 种以上系统）' }, pick: (s) => [s.answers.os.length > 1 ? 'multi' : 'single'] },
      { q: 'E3', title: '用量上限', labels: USAGE_CAP, pick: (s) => [s.answers.usageCap] },
      { q: 'E4', title: '对话语言', labels: CHAT_LANGUAGE, pick: (s) => [s.answers.chatLanguage] },
      { q: 'E5', title: '谁在用这个账号', labels: SHARING, pick: (s) => [s.answers.sharing] },
    ],
  },
  {
    title: '高风险用法',
    desc: '比较有和没有的被封占比',
    dims: [
      { q: 'E6', title: '逆向或反代', labels: HAS, pick: (s) => [s.answers.reverseProxy.includes('none') ? 'no' : 'yes'] },
      {
        q: 'E7',
        title: '破限或 NSFW',
        labels: HAS,
        pick: (s) => [s.answers.jailbreak === 'never' ? 'no' : s.answers.jailbreak === 'decline' ? 'decline' : 'yes'],
      },
      { q: 'E8', title: '蒸馏', labels: HAS, pick: (s) => one(s.answers.distill) },
      {
        q: 'E9',
        title: '高危用途',
        labels: HAS,
        // 选了网络安全、批量生成、自动化脚本任一为「有」
        pick: (s) => {
          const u = s.answers.sensitiveUse;
          if (!u) return null;
          return [u.includes('decline') ? 'decline' : u.includes('none') ? 'no' : 'yes'];
        },
      },
    ],
  },
];

/** 低频取值（国家）少于这个份数合并为「其他」 */
const RARE = 5;

function countDim(def: DimDef, subs: Sub[]): BoardDim | null {
  const counts = new Map<string, Counts>();
  let base = 0;
  for (const s of subs) {
    const keys = def.pick(s);
    if (keys) base++;
    for (const k of keys ?? []) {
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
  } else if (def.ordered) {
    const label = def.ordered;
    rows = [...counts]
      .sort(([a], [b]) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b)))
      .map(([k, c]) => ({ key: k, label: label(k), c }));
  } else {
    rows = Object.entries(def.labels).flatMap(([k, label]) => (counts.has(k) ? [{ key: k, label, c: counts.get(k)! }] : []));
  }
  return { q: def.q, title: def.title, multi: def.multi, country: def.country, base: def.dist ? base : undefined, rows };
}

function part(defs: GroupDef[], subs: Sub[]): BoardPart {
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
    account: part(ACCOUNT, subs),
    bannedDists: BANNED_DISTS.flatMap((d) => countDim(d, banned) ?? []),
    network: { scoped: part(NETWORK, behClean), all: part(NETWORK, subs) },
    usage: { scoped: part(USAGE, envClean), all: part(USAGE, subs) },
    timeline,
    byEnv: [
      pair('B2', '使用多久后被封', BAN_AFTER, (a) => a.banAfter),
      pair('B5', '封禁通知里写的原因', BAN_REASON, (a) => a.banReason),
    ],
  };
}
