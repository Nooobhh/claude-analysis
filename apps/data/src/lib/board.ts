// 看板数据结构：Worker（worker/board.ts）汇总后下发，看板页只拿到这些份数，拿不到任何单份问卷。
// 统计口径与分组规则见 docs/specs/board.md

/** 一组问卷按账号当前状态的份数 */
export interface Counts {
  banned: number;
  restored: number;
  active: number;
}

export interface BoardRow {
  key: string;
  label: string;
  c: Counts;
}

export interface BoardDim {
  /** 题号；检测项写「检测」 */
  q: string;
  title: string;
  multi?: boolean;
  /** 选项是国家代码，页面换成中文名 */
  country?: boolean;
  rows: BoardRow[];
}

export interface BoardGroup {
  title: string;
  desc?: string;
  dims: BoardDim[];
}

/** 用户行为 / 使用环境：scoped = 默认范围（环境干净 / 行为干净），all = 全部样本 */
export interface BoardSection {
  scoped: { total: Counts; groups: BoardGroup[] };
  all: { total: Counts; groups: BoardGroup[] };
}

/** 四象限：c / p = 环境干净 / 有问题，c / v = 行为干净 / 有违规项 */
export type QuadKey = 'cc' | 'cv' | 'pc' | 'pv';

/** 被封过的账号按环境分两组对比（使用多久后被封、封禁通知里写的原因） */
export interface PairDim {
  q: string;
  title: string;
  rows: Array<{ key: string; label: string; clean: Counts; problem: Counts }>;
}

export interface BoardData {
  updatedOn: string;
  total: number;
  detect: number;
  quad: Record<QuadKey, Counts>;
  /** 环境或行为无法判定、没进四象限的份数 */
  undetermined: number;
  behavior: BoardSection;
  environment: BoardSection;
  /** 按封禁月份（YYYY-MM），月份连续 */
  timeline: Array<{ month: string; banned: number; restored: number }>;
  byEnv: PairDim[];
}

export type BoardResponse = { ok: true; data: BoardData } | { ok: false; error: 'server' };

/** 少于这个份数标「低样本」 */
export const MIN_N = 30;

export const total = (c: Counts) => c.banned + c.restored + c.active;
/** 被封过 = 已被封禁 + 被封后申诉恢复 */
export const bannedEver = (c: Counts) => c.banned + c.restored;

/** Wilson 95% 区间 */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
