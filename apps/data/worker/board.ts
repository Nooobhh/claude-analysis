// 看板汇总：把每份问卷判成「环境干净 / 有问题 / 无法判定」「行为干净 / 有违规项 / 无法判定」，再按维度数份数。
// 规则与 docs/specs/board.md「环境判定」「行为判定」一致，改规则先改 spec；网络环境、设备指纹的扣分规则在 shared scoring.ts，
// 与检测站结论卡共用。只在服务器上跑，下发的只有份数
import {
  ACCOUNT_SOURCE,
  ACCOUNTS_IN_ENV,
  BAN_AFTER,
  BAN_REASON,
  CARD_KIND,
  CLIENT,
  DISTILL,
  ENV_BAN_HISTORY,
  ENV_PASS_SCORE,
  JAILBREAK,
  LOGIN_METHOD,
  PAYMENT_METHOD,
  PHONE_VERIFY,
  PLAN,
  REVERSE_PROXY,
  SENSITIVE_USE,
  SHARING,
  SUPPORTED_COUNTRIES,
  USAGE_CAP,
  judgeFingerprint,
  judgeNetwork,
  type AccountStatus,
  type CardInfo,
  type CheckId,
  type DetectSnapshot,
  type EnvVerdict,
  type ManagedSubmission,
  type ManualEnv,
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

/** 环境干净 = 网络环境、设备指纹都通过；账号环境、支付环境只展示，不进判定 */
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
  /** 选项与显示顺序；country 维度为空，按份数排 */
  labels: Record<string, string>;
  /** 这份问卷选了哪些选项；没问到 / 不适用返回 null */
  pick: (s: Sub) => string[] | null;
  multi?: boolean;
  country?: boolean;
}

const one = (v: string | undefined | null) => (v ? [v] : null);

const SEVERITY: Record<Status, number> = { unknown: 0, ok: 1, warn: 2, bad: 3 };
/** 合成维度的三档 */
const LEVEL = { ok: '正常', warn: '有注意项', bad: '有异常项' };

/** 几个检测项合成一个维度，取最严重的一项；manual 给出手动样本对应的档位。设备指纹类遇到「检测设备不是使用设备」不计入 */
function levelDim(
  q: string,
  title: string,
  ids: CheckId[],
  opts: { fingerprint?: boolean; manual?: (m: ManualEnv) => Status | null } = {},
): DimDef {
  return {
    q,
    title,
    labels: LEVEL,
    pick: (s) => {
      if (s.snapshot) {
        if (opts.fingerprint && !fpUsable(s)) return null;
        const worst = ids.map((id) => s.snapshot!.local.status[id]).reduce<Status | undefined>((a, b) => (b && (!a || SEVERITY[b] > SEVERITY[a]) ? b : a), undefined);
        // 全是「未知」不计入
        return worst && worst !== 'unknown' ? [worst] : null;
      }
      const m = manual(s);
      return one(m && opts.manual ? opts.manual(m) : null);
    },
  };
}

const PASS = { clean: '通过', problem: '不通过' };
const verdictDim = (title: string, judge: (s: Sub) => Tri): DimDef => ({
  q: '判定',
  title,
  labels: PASS,
  pick: (s) => {
    const v = judge(s);
    return v === 'unknown' ? null : [v];
  },
});

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
    title: '网络环境',
    desc: `进环境判定：有异常项，或扣分后低于 ${ENV_PASS_SCORE} 分，算不通过`,
    dims: [
      verdictDim('网络环境', networkOf),
      { q: 'D2', title: '代理情况', labels: EXIT_SHORT, pick: (s) => [s.env.exitType] },
      levelDim('检测 + M1 M5', '出口', ['exit.proxied', 'ip.region', 'exit.consistency', 'exit.drift'], {
        manual: (m) =>
          (m.exitRegion !== null && !SUPPORTED_COUNTRIES.has(m.exitRegion)) || m.nodeSwitch === 'auto'
            ? 'bad'
            : m.exitRegion === null && m.nodeSwitch === 'unknown'
              ? null
              : 'ok',
      }),
      levelDim('检测', 'IP 质量', ['ip.type', 'ip.native', 'ip.vpn', 'ip.proxy', 'ip.tor', 'ip.abuser', 'ip.score']),
      levelDim('检测', '泄露', ['leak.webrtc', 'leak.dns']),
    ],
  },
  {
    title: '设备指纹',
    desc: `进环境判定：扣分后低于 ${ENV_PASS_SCORE} 分算不通过；检测设备不是使用设备的检测站样本不计入`,
    dims: [
      verdictDim('设备指纹', fingerprintOf),
      levelDim('检测 + M3', '时区', ['fp.timezone', 'cross.timezone'], {
        fingerprint: true,
        manual: (m) => (m.timezone === 'match_exit' ? 'ok' : m.timezone === 'unknown' ? null : 'warn'),
      }),
      levelDim('检测 + M4', '语言与格式', ['fp.language', 'fp.locale', 'cross.language'], {
        fingerprint: true,
        manual: (m) => (m.language === 'zh' ? 'warn' : 'ok'),
      }),
      levelDim('检测 + M6', '中文软件痕迹', ['fp.fonts', 'fp.browser', 'fp.device'], {
        fingerprint: true,
        manual: (m) => (m.cnClient === 'yes' ? 'warn' : m.cnClient === 'no' ? 'ok' : null),
      }),
    ],
  },
  {
    title: '账号环境',
    desc: '只展示，不进判定',
    dims: [
      { q: 'C2', title: '登录方式', labels: LOGIN_METHOD, pick: (s) => [s.answers.login] },
      { q: 'C4', title: '手机号验证', labels: PHONE_VERIFY, pick: (s) => [s.answers.phone] },
      { q: 'C9', title: '同环境别的号被封过', labels: ENV_BAN_HISTORY, pick: (s) => [s.answers.envBanHistory] },
    ],
  },
  {
    title: '支付环境',
    desc: '只展示，不进判定',
    dims: [
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
    ],
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
