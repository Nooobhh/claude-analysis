// IP 属性与风险（经本站 Worker 查询）+ 交叉比对
import type { IpApiError, IpApiResponse, IpInfo } from '@claude-analysis/shared';
import { countryName, fetchWithTimeout } from '../net';
import { flag, type Result } from '../result';
import { SUPPORTED_COUNTRIES, ZH_SPEAKING } from '../regions';
import { formatOffset, primaryIsHans, type Fingerprint } from './fingerprint';

/** 只发送 Claude 出口 IP；放在 POST body 里，不进 URL */
export async function fetchIpInfo(target: string): Promise<IpApiResponse> {
  try {
    const res = await fetchWithTimeout('/api/ip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ip: target }),
      timeoutMs: 10000,
    });
    return (await res.json()) as IpApiResponse;
  } catch {
    return { ok: false, error: 'upstream' };
  }
}

const API_ERROR: Record<IpApiError, string> = {
  bad_request: '该 IP 无法查询',
  rate_limited: '查询太频繁，请稍后再试',
  upstream: 'IP 数据源暂时不可用',
};

export const infoOf = (r: IpApiResponse | null): IpInfo | null => (r?.ok ? r.data : null);

function failed(r: IpApiResponse | null, withReason = true): Result {
  const reason = r && !r.ok ? API_ERROR[r.error] : '没有拿到 Claude 出口 IP';
  return { status: 'unknown', tag: '查询失败', value: [], reason: withReason ? reason : undefined };
}

/** 地区判定优先用 trace 的 loc（Cloudflare 的判定 = Claude 那边看到的） */
export function judgeRegion(cc: string | undefined): Result {
  if (!cc || cc === 'XX') return { status: 'unknown', tag: '无法判断', value: [] };
  if (cc === 'T1') return { status: 'bad', tag: 'Tor 网络', value: [], reason: '出口是 Tor 节点' };
  const value = [...flag(cc), countryName(cc)];
  if (SUPPORTED_COUNTRIES.has(cc)) return { status: 'ok', tag: '支持地区', value };
  if (['CN', 'HK', 'MO'].includes(cc)) return { status: 'bad', tag: '不支持', value, reason: `Claude 不支持${countryName(cc)}` };
  return { status: 'bad', tag: '不支持', value, reason: '不在 Anthropic 公布的支持地区列表内' };
}

const NET_TYPE: Record<string, string> = {
  residential: '家庭宽带',
  isp: '运营商',
  wireless: '移动网络',
  business: '企业网络',
  education: '教育网',
  government: '政府网络',
  banking: '金融机构',
};

export function judgeType(r: IpApiResponse | null): Result {
  const info = infoOf(r);
  if (!info) return failed(r);
  const risk = info.risk;
  if (!risk) return { status: 'unknown', tag: '暂无数据', value: [], reason: '风险数据源暂时不可用，只拿到了基础属性' };
  if (risk.isDatacenter || risk.type === 'hosting') {
    const by = risk.flaggedBy.datacenter.length && info.sources.length > 1 ? `，由 ${risk.flaggedBy.datacenter.join('、')} 标记` : '';
    return { status: 'warn', tag: '机房', value: [risk.datacenter ?? ''], reason: `机房 IP 容易被识别为代理或 VPN${by}` };
  }
  if (risk.isMobile) return { status: 'ok', tag: NET_TYPE.wireless, value: [] };
  const label = NET_TYPE[risk.type ?? ''];
  return label ? { status: 'ok', tag: label, value: [] } : { status: 'unknown', tag: '未知', value: [risk.type ?? ''] };
}

export function judgeAsn(r: IpApiResponse | null): Result {
  const asn = infoOf(r)?.asn;
  return { value: [asn ? `AS${asn}` : '—'] };
}

export function judgeOrg(r: IpApiResponse | null): Result {
  return { value: [infoOf(r)?.org ?? '—'] };
}

export function judgeLocation(r: IpApiResponse | null): Result {
  const info = infoOf(r);
  if (!info) return { value: ['—'] };
  const place = [info.city, info.region].filter(Boolean).join(' · ') || '—';
  return { value: [place], reason: [info.timezone && `时区 ${info.timezone}`, `数据来源 ${info.sources.join(' + ')}`].filter(Boolean).join(' · ') };
}

/** VPN / 代理 / Tor / 滥用：命中即异常 */
export function judgeFlag(r: IpApiResponse | null, key: 'vpn' | 'proxy' | 'tor' | 'abuser'): Result {
  const info = infoOf(r);
  if (!info) return failed(r, false);
  const risk = info.risk;
  if (!risk) return { status: 'unknown', tag: '暂无数据', value: [] };
  const note = { vpn: risk.vpnService, proxy: null, tor: null, abuser: risk.abuserScore }[key];
  const by = risk.flaggedBy[key];
  // 两家并行查询时任一家标记即命中，注明是谁标的
  const reason = by.length && info.sources.length > 1 ? `由 ${by.join('、')} 标记` : undefined;
  if (key === 'abuser') return by.length ? { status: 'bad', tag: '有记录', value: [note ?? ''], reason } : { status: 'ok', tag: '无记录', value: [] };
  return by.length ? { status: 'bad', tag: '检测到', value: [note ?? ''], reason } : { status: 'ok', tag: '未检测到', value: [] };
}

/** proxycheck.io 的 0–100 风险分：≥67 高、≥34 中（其官方分档） */
export function judgeScore(r: IpApiResponse | null): Result {
  const info = infoOf(r);
  if (!info) return failed(r, false);
  const score = info.risk?.riskScore;
  if (score === null || score === undefined) return { value: ['—'], reason: '当前数据源不提供风险分' };
  const value = [`${score} / 100`];
  const reason = 'proxycheck.io 给出的风险分，越低越好';
  if (score >= 67) return { status: 'bad', tag: '高风险', value, reason };
  if (score >= 34) return { status: 'warn', tag: '中风险', value, reason };
  return { status: 'ok', tag: '低风险', value, reason };
}

/** 某时区当前的 UTC 偏移（分钟）；无法识别返回 null */
function tzOffsetMin(tz: string): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    if (name === 'GMT') return 0;
    const m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(name ?? '');
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  } catch {
    return null;
  }
}

export function judgeCrossTimezone(fp: Fingerprint, r: IpApiResponse | null): Result {
  const tz = infoOf(r)?.timezone;
  const ipOffset = tz ? tzOffsetMin(tz) : null;
  if (!tz || ipOffset === null) return { status: 'unknown', tag: '无法判断', value: [], reason: '没有拿到 IP 所在时区' };
  const value = [`系统 ${formatOffset(fp.offsetMin)} · IP ${formatOffset(ipOffset)}`];
  if (ipOffset === fp.offsetMin) return { status: 'ok', tag: '一致', value };
  const diff = Math.abs(ipOffset - fp.offsetMin) / 60;
  return { status: 'warn', tag: '不一致', value, reason: `系统时区与 IP 所在地（${tz}）相差 ${diff} 小时` };
}

export function judgeCrossLanguage(fp: Fingerprint, cc: string | undefined): Result {
  if (!cc || cc === 'XX' || cc === 'T1') return { status: 'unknown', tag: '无法判断', value: [], reason: '无法判断出口所在地区' };
  const value = [`${fp.languages[0] ?? '未知'} · ${countryName(cc)}`];
  if (primaryIsHans(fp.languages) && !ZH_SPEAKING.has(cc)) {
    return { status: 'warn', tag: '矛盾', value, reason: `IP 在${countryName(cc)}，浏览器首选语言却是简体中文` };
  }
  return { status: 'ok', tag: '合理', value };
}
