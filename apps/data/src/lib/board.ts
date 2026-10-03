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
  /** 只有被封的账号答的题：展示分布（占 base 个被封账号的比例），不算被封占比 */
  base?: number;
  rows: BoardRow[];
}

export interface BoardGroup {
  title: string;
  desc?: string;
  dims: BoardDim[];
}

export interface BoardPart {
  total: Counts;
  groups: BoardGroup[];
}

/** 网络环境 / 使用习惯：scoped = 默认范围（行为干净 / 环境干净），all = 全部样本 */
export interface BoardSection {
  scoped: BoardPart;
  all: BoardPart;
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
  /** 账号情况（A+B+C）：全部样本；groups = 注册、账号来历 */
  account: BoardPart;
  /** 只有被封的账号答的题（B3 / B4 / C7）的分布 */
  bannedDists: BoardDim[];
  network: BoardSection;
  usage: BoardSection;
  /** 按封禁月份（YYYY-MM），月份连续 */
  timeline: Array<{ month: string; banned: number; restored: number }>;
  byEnv: PairDim[];
}

export type BoardResponse = { ok: true; data: BoardData } | { ok: false; error: 'server' };

/** 下发结构的版本：浏览器会缓存 /api/board 5 分钟，改了结构就加 1，页面请求的地址随之变化，不会读到旧结构 */
export const BOARD_VERSION = 2;

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
