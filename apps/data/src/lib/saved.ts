// 浏览器里记住的问卷：只存管理密钥（答案每次凭密钥从服务器取），放在 localStorage。
// 隐私模式或禁用存储时读写会失败，一律当作没记住；隐私页对此有说明
import type { ManageResponse } from '@claude-analysis/shared';

const STORAGE_KEY = 'claudeban.saved';
const KEY = /^[A-Za-z0-9_-]{22}$/;

export interface Saved {
  key: string;
  /** 记住的日期（本地时间 YYYY-MM-DD），服务器读不到时用它显示 */
  savedOn: string;
}

export function listSaved(): Saved[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((s): s is Saved => typeof s?.key === 'string' && KEY.test(s.key) && typeof s.savedOn === 'string');
  } catch {
    return [];
  }
}

function write(list: Saved[]): boolean {
  try {
    if (list.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 记住一份问卷，已记住的不重复加；浏览器不让存时返回 false */
export function addSaved(key: string): boolean {
  const list = listSaved();
  if (list.some((s) => s.key === key)) return true;
  return write([...list, { key, savedOn: today() }]);
}

export function removeSaved(key: string): void {
  write(listSaved().filter((s) => s.key !== key));
}

/** 凭密钥取问卷（密钥放在请求头里，不进 URL）；网络出错返回 null */
export async function fetchSubmission(key: string): Promise<ManageResponse | null> {
  try {
    const res = await fetch('/api/submission', { headers: { authorization: `Bearer ${key}` } });
    return (await res.json()) as ManageResponse;
  } catch {
    return null;
  }
}
