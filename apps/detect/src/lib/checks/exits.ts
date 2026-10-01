// 出口 IP：各 Anthropic 域名的 trace、国内出口、是否走代理、多域名一致、漂移
import { countryName, fetchWithTimeout, type Trace } from '../net';
import { flag, ip, type Detail, type Result } from '../result';

export interface Domestic {
  ip: string;
  place: string;
  /** 是否中国大陆 IP；全局代理时国内站点也走代理，拿到的就不是真实国内 IP */
  inMainland: boolean;
}

const NOT_MAINLAND = ['香港', '澳门', '台湾'];

/** 国内出口：ipip.net 为主、又拍云兜底；结果只在本地使用 */
export async function getDomestic(): Promise<Domestic | null> {
  try {
    const res = await fetchWithTimeout('https://myip.ipip.net/json', { timeoutMs: 5000 });
    const d = (await res.json()) as { data?: { ip?: string; location?: string[] } };
    // 境外 IP 时国家和省份字段相同（["美国", "美国", …]），去重
    const loc = [...new Set((d.data?.location ?? []).filter(Boolean))];
    if (d.data?.ip) {
      return { ip: d.data.ip, place: loc.join(' '), inMainland: loc[0] === '中国' && !NOT_MAINLAND.includes(loc[1]) };
    }
  } catch {
    /* 换下一个 */
  }
  try {
    const res = await fetchWithTimeout(`https://pubstatic.b0.upaiyun.com/?_upnode&t=${Date.now()}`, { timeoutMs: 5000 });
    const d = (await res.json()) as {
      remote_addr?: string;
      remote_addr_location?: { country?: string; province?: string; city?: string; isp?: string };
    };
    const l = d.remote_addr_location ?? {};
    if (d.remote_addr) {
      return {
        ip: d.remote_addr,
        place: [...new Set([l.country, l.province, l.city, l.isp].filter(Boolean))].join(' '),
        inMainland: l.country === '中国' && !NOT_MAINLAND.includes(l.province ?? ''),
      };
    }
  } catch {
    /* 都失败 */
  }
  return null;
}

export function judgeExit(t: Trace | null, host: string): Result {
  if (!t) return { status: 'bad', tag: '无法访问', value: ['—'], reason: `请求 ${host} 失败，可能被代理规则拦截或网络不通` };
  return { value: [...flag(t.loc), ip(t.ip)], reason: `${countryName(t.loc)} · ${t.colo} 机房` };
}

export function judgeDomestic(d: Domestic | null, claude: Trace | null): Result {
  if (!d) return { value: ['未获取到'], reason: '国内 IP 查询站点无法访问' };
  if (!d.inMainland) {
    // 国内站点也走了代理：和 claude.ai 出口相同时借用它的国家代码显示国旗
    const cc = claude?.ip === d.ip ? claude.loc : undefined;
    return {
      tag: '经过代理',
      value: [...flag(cc), ip(d.ip)],
      reason: `${d.place} · 国内站点也经过代理（全局模式），这不是你的宽带 IP`,
    };
  }
  return { value: [...flag('CN'), ip(d.ip)], reason: d.place };
}

export function judgeProxied(claude: Trace | null, d: Domestic | null): Result {
  if (!claude) return { status: 'unknown', tag: '无法判断', value: [], reason: '没有拿到 claude.ai 出口' };
  if (claude.loc === 'CN') return { status: 'bad', tag: '未走代理', value: [], reason: 'claude.ai 看到的出口在中国大陆' };
  if (d?.inMainland && d.ip === claude.ip) {
    return { status: 'bad', tag: '未走代理', value: [], reason: 'claude.ai 出口与国内宽带 IP 相同，Claude 流量是直连的' };
  }
  return { status: 'ok', tag: '已走代理', value: [], reason: d?.inMainland ? 'claude.ai 出口与国内宽带 IP 不同' : 'claude.ai 出口在境外' };
}

export function judgeConsistency(traces: Array<[string, Trace | null]>): Result {
  const okList = traces.filter((t): t is [string, Trace] => t[1] !== null);
  if (!okList.length) return { status: 'bad', tag: '全部失败', value: [], reason: 'Anthropic 各域名都请求失败' };

  // 以出现最多的 IP 为主出口，其余标红
  const tally = new Map<string, number>();
  for (const [, t] of okList) tally.set(t.ip, (tally.get(t.ip) ?? 0) + 1);
  const main = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const details: Detail[] = traces.map(([host, t]) => ({
    label: host,
    value: t ? [...flag(t.loc), ip(t.ip)] : ['失败'],
    status: !t ? 'warn' : t.ip === main ? undefined : 'bad',
  }));

  const total = traces.length;
  const same = okList.filter(([, t]) => t.ip === main).length;
  if (tally.size > 1) {
    return {
      status: 'bad',
      tag: `${tally.size} 个出口`,
      value: [],
      reason: '同一账号在 Anthropic 侧会出现多个 IP，通常是分流规则只覆盖了部分域名',
      details,
    };
  }
  if (okList.length < total) return { status: 'warn', tag: `${same}/${total} 一致`, value: [], reason: `${total - okList.length} 个域名请求失败`, details };
  return { status: 'ok', tag: `${total}/${total} 一致`, value: [], details };
}

export function judgeDrift(samples: Array<Trace | null>): Result {
  const got = samples.filter((t): t is Trace => t !== null);
  if (got.length < 2) return { status: 'unknown', tag: '采样不足', value: [], reason: 'claude.ai 多次请求失败' };
  const distinct = new Set(got.map((t) => t.ip));
  const details: Detail[] = samples.map((t, i) => ({ label: `第 ${i + 1} 次`, value: t ? [ip(t.ip)] : ['失败'] }));
  if (distinct.size > 1) {
    return {
      status: 'bad',
      tag: `${distinct.size} 个 IP`,
      value: [],
      reason: '出口在几秒内变化，常见于负载均衡或轮询节点，Claude 会看到同一会话的 IP 来回切换',
      details,
    };
  }
  return { status: 'ok', tag: `${got.length} 次一致`, value: [], details };
}
