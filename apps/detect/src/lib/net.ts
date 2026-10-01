// 浏览器端网络小工具：带超时的 fetch、trace 解析、IP 打码

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 6000, ...rest } = init;
  return fetch(url, { cache: 'no-store', ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

export interface Trace {
  ip: string;
  /** Cloudflare 判定的国家 / 地区代码 */
  loc: string;
  /** 接入的 Cloudflare 机房 */
  colo: string;
  /** 本次请求耗时 ms */
  ms: number;
}

/** 读取 https://<host>/cdn-cgi/trace；失败返回 null */
export async function getTrace(host: string): Promise<Trace | null> {
  try {
    const start = performance.now();
    const res = await fetchWithTimeout(`https://${host}/cdn-cgi/trace`);
    const text = await res.text();
    const ms = Math.round(performance.now() - start);
    const kv = Object.fromEntries(
      text
        .split('\n')
        .map((line) => line.split('='))
        .filter((p) => p.length === 2),
    );
    return kv.ip ? { ip: kv.ip, loc: kv.loc ?? '', colo: kv.colo ?? '', ms } : null;
  } catch {
    return null;
  }
}

/** IPv4 保留前两段，IPv6 保留前两组 */
export function maskIp(ip: string): string {
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:*`;
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.*.*` : '*';
}

export function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

/** 国家代码 → 中文名；无法识别时原样返回 */
export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
