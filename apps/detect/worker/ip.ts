// IP 属性查询：ipapi.is 与 proxycheck.io 并行查、合并结果（保留各家结论，分歧由前端并排显示）；
// 两家都失败时 ipinfo 兜底（只有基础属性）。同时查 RDAP 拿 IP 段登记国家，用于判断原生 IP
import type { IpInfo, IpRegistration, IpRisk, IpSource, RiskFlag } from '@claude-analysis/shared';
import { connect } from 'cloudflare:sockets';

export interface Secrets {
  /** 缓存 / 限频 key 的哈希盐；未配置时不缓存 */
  IP_HASH_SALT?: string;
  /** ipapi.is 免费账号 key；未配置时跳过 ipapi.is */
  IPAPI_KEY?: string;
  /** proxycheck.io 免费账号 key（1000 次/天）；线上 Workers 出口共享，匿名额度基本被占满 */
  PROXYCHECK_KEY?: string;
  /** ipinfo token，可选；不带时走匿名额度 */
  IPINFO_TOKEN?: string;
  /** 结果码签名私钥（Ed25519，PKCS#8 base64）；未配置时 /api/ip 不带签名，检测页不能复制结果码 */
  RESULT_CODE_KEY?: string;
}

const UPSTREAM_TIMEOUT_MS = 4000;

/** 单一数据源的标记 → flaggedBy */
function flagsOf(source: IpSource, hits: Record<RiskFlag, boolean>): Record<RiskFlag, IpSource[]> {
  const out = {} as Record<RiskFlag, IpSource[]>;
  for (const k of Object.keys(hits) as RiskFlag[]) out[k] = hits[k] ? [source] : [];
  return out;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** 只接受公网 IP，私有 / 保留地址直接拒绝，省上游额度 */
export function isPublicIp(ip: string): boolean {
  if (IPV4.test(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (!ip.includes(':') || ip.length > 45) return false;
  try {
    new URL(`http://[${ip}]/`);
  } catch {
    return false;
  }
  const head = ip.toLowerCase();
  return !(head === '::' || head === '::1' || /^f[cd]/.test(head) || /^fe[89ab]/.test(head));
}

interface IpapiResponse {
  error?: string;
  is_mobile?: boolean;
  is_datacenter?: boolean;
  is_tor?: boolean;
  is_proxy?: boolean;
  is_vpn?: boolean;
  is_abuser?: boolean;
  datacenter?: { datacenter?: string };
  company?: { name?: string; type?: string; abuser_score?: string };
  asn?: { asn?: number; org?: string; type?: string; abuser_score?: string };
  location?: { country_code?: string; state?: string; city?: string; timezone?: string };
  vpn?: { service?: string };
}

async function fromIpapi(ip: string, key: string): Promise<IpInfo | null> {
  // key 放 POST body，不进 URL
  const res = await fetch('https://api.ipapi.is', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: ip, key }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const d = await res.json<IpapiResponse>();
  // 没有 location 说明落到了匿名层（key 失效），当失败处理
  if (d.error || !d.location) return null;
  return {
    ip,
    sources: ['ipapi.is'],
    registration: null,
    countryCode: d.location.country_code?.toUpperCase() ?? null,
    region: d.location.state ?? null,
    city: d.location.city ?? null,
    timezone: d.location.timezone ?? null,
    asn: d.asn?.asn ?? null,
    org: d.asn?.org ?? d.company?.name ?? null,
    risk: {
      type: d.company?.type ?? d.asn?.type ?? null,
      riskScore: null,
      isDatacenter: !!d.is_datacenter,
      isVpn: !!d.is_vpn,
      isProxy: !!d.is_proxy,
      isTor: !!d.is_tor,
      isAbuser: !!d.is_abuser,
      isMobile: !!d.is_mobile,
      datacenter: d.datacenter?.datacenter ?? null,
      vpnService: d.vpn?.service ?? null,
      abuserScore: d.company?.abuser_score ?? d.asn?.abuser_score ?? null,
      typeBy: d.company?.type ?? d.asn?.type ? { 'ipapi.is': (d.company?.type ?? d.asn?.type)! } : {},
      flaggedBy: flagsOf('ipapi.is', {
        vpn: !!d.is_vpn,
        proxy: !!d.is_proxy,
        tor: !!d.is_tor,
        abuser: !!d.is_abuser,
        datacenter: !!d.is_datacenter,
      }),
    },
  };
}

interface ProxycheckResponse {
  status?: string;
  [ip: string]:
    | undefined
    | string
    | {
        network?: { asn?: string; provider?: string; organisation?: string; type?: string };
        location?: { country_code?: string; region_name?: string; city_name?: string; timezone?: string };
        detections?: {
          proxy?: boolean;
          vpn?: boolean;
          compromised?: boolean;
          tor?: boolean;
          hosting?: boolean;
          risk?: number;
        };
        operator?: { name?: string } | null;
      };
}

async function fromProxycheck(ip: string, key?: string): Promise<IpInfo | null> {
  const url = `https://proxycheck.io/v3/${encodeURIComponent(ip)}${key ? `?key=${key}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json<ProxycheckResponse>();
  const d = body[ip];
  // status 为 denied / error（额度用尽等）时没有 IP 数据
  if (!d || typeof d === 'string' || !d.detections) return null;
  const { network: n = {}, location: l = {}, detections: x } = d;
  const type = n.type?.toLowerCase() ?? null;
  return {
    ip,
    sources: ['proxycheck.io'],
    registration: null,
    countryCode: l.country_code?.toUpperCase() ?? null,
    region: l.region_name ?? null,
    city: l.city_name ?? null,
    timezone: l.timezone ?? null,
    asn: n.asn ? Number(n.asn.replace(/^AS/i, '')) || null : null,
    org: n.provider ?? n.organisation ?? null,
    risk: {
      type,
      riskScore: x.risk ?? null,
      isDatacenter: !!x.hosting,
      isVpn: !!x.vpn,
      isProxy: !!x.proxy,
      isTor: !!x.tor,
      isAbuser: !!x.compromised,
      isMobile: type === 'wireless',
      datacenter: null,
      vpnService: d.operator?.name ?? null,
      abuserScore: null,
      typeBy: type ? { 'proxycheck.io': type } : {},
      flaggedBy: flagsOf('proxycheck.io', {
        vpn: !!x.vpn,
        proxy: !!x.proxy,
        tor: !!x.tor,
        abuser: !!x.compromised,
        datacenter: !!x.hosting,
      }),
    },
  };
}

interface IpinfoResponse {
  bogon?: boolean;
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
  /** 形如 "AS398704 STACKS INC" */
  org?: string;
}

async function fromIpinfo(ip: string, token?: string): Promise<IpInfo | null> {
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${token ? `?token=${token}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) return null;
  const d = await res.json<IpinfoResponse>();
  if (d.bogon) return null;
  const m = /^AS(\d+)\s+(.*)$/.exec(d.org ?? '');
  return {
    ip,
    sources: ['ipinfo'],
    registration: null,
    countryCode: d.country?.toUpperCase() ?? null,
    region: d.region ?? null,
    city: d.city ?? null,
    timezone: d.timezone ?? null,
    asn: m ? Number(m[1]) : null,
    org: m ? m[2] : d.org ?? null,
    risk: null,
  };
}

/** 两家结果合并：基础属性优先 ipapi.is；风险项取并集并记下是谁标的，类型保留各家原值 */
function merge(a: IpInfo, b: IpInfo): IpInfo {
  const ra = a.risk as IpRisk;
  const rb = b.risk as IpRisk;
  const flaggedBy = {} as Record<RiskFlag, IpSource[]>;
  for (const k of Object.keys(ra.flaggedBy) as RiskFlag[]) flaggedBy[k] = [...ra.flaggedBy[k], ...rb.flaggedBy[k]];
  return {
    ip: a.ip,
    sources: [...a.sources, ...b.sources],
    registration: null,
    countryCode: a.countryCode ?? b.countryCode,
    region: a.region ?? b.region,
    city: a.city ?? b.city,
    timezone: a.timezone ?? b.timezone,
    asn: a.asn ?? b.asn,
    org: a.org ?? b.org,
    risk: {
      // proxycheck 能区分家宽（residential）与移动网络，类型以它为准
      type: rb.type ?? ra.type,
      riskScore: rb.riskScore,
      isDatacenter: flaggedBy.datacenter.length > 0,
      isVpn: flaggedBy.vpn.length > 0,
      isProxy: flaggedBy.proxy.length > 0,
      isTor: flaggedBy.tor.length > 0,
      isAbuser: flaggedBy.abuser.length > 0,
      isMobile: ra.isMobile || rb.isMobile,
      datacenter: ra.datacenter,
      vpnService: ra.vpnService ?? rb.vpnService,
      abuserScore: ra.abuserScore,
      flaggedBy,
      typeBy: { ...ra.typeBy, ...rb.typeBy },
    },
  };
}

interface RdapNetwork {
  name?: string;
  country?: string;
  entities?: Array<{ roles?: string[]; vcardArray?: [string, Array<[string, { label?: string }, ...unknown[]]>] }>;
}

const RIR_BY_HOST: Array<[string, string]> = [
  ['arin', 'ARIN'],
  ['ripe', 'RIPE NCC'],
  ['apnic', 'APNIC'],
  ['lacnic', 'LACNIC'],
  ['registro.br', 'LACNIC'],
  ['afrinic', 'AFRINIC'],
];

let countryCodeByName: Map<string, string> | undefined;

/** 英文国家名 → 两位代码（ARIN 只在地址里写国家全名） */
function codeOfCountryName(name: string): string | null {
  if (!countryCodeByName) {
    countryCodeByName = new Map();
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        try {
          const n = names.of(code);
          if (n && n !== code) countryCodeByName.set(n.toLowerCase(), code);
        } catch {
          /* 非法代码跳过 */
        }
      }
    }
  }
  return countryCodeByName.get(name.trim().toLowerCase()) ?? null;
}

/** whois 43 端口查 ARIN：多段时按「上级 → 最具体」排列，取最后一段的 Country / NetName */
async function fromArinWhois(ip: string): Promise<IpRegistration | null> {
  const socket = connect({ hostname: 'whois.arin.net', port: 43 });
  const query = (async () => {
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(`n + ${ip}\r\n`));
    const text = await new Response(socket.readable).text();
    const last = (key: string) => [...text.matchAll(new RegExp(`^${key}:\\s*(.+)$`, 'gm'))].at(-1)?.[1].trim() ?? null;
    const country = last('Country');
    return country ? { country: country.toUpperCase(), rir: 'ARIN', netname: last('NetName') } : null;
  })();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), UPSTREAM_TIMEOUT_MS));
  try {
    return await Promise.race([query.catch(() => null), timeout]);
  } finally {
    socket.close().catch(() => {});
  }
}

/**
 * 查 IP 段登记信息。先走 RIPE 的 RDAP 入口：各 RIR 会把不归自己管的地址重定向到正确的机构。
 * ARIN 的 RDAP 挂在 Cloudflare 后面，Workers 访问常成串返回 525（2026-10-01 实测），
 * 重定向落到 ARIN 失败时改查 ARIN 的 whois 43 端口（实测稳定）
 */
async function fromRdap(ip: string): Promise<IpRegistration | null> {
  let res: Response | null = null;
  for (let i = 0; i < 2 && !res?.ok; i++) {
    res = await fetch(`https://rdap.db.ripe.net/ip/${encodeURIComponent(ip)}`, {
      headers: { accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    }).catch(() => null);
    if (res && !res.ok && new URL(res.url).hostname.includes('arin')) return fromArinWhois(ip);
  }
  if (!res?.ok) return null;
  const d = await res.json<RdapNetwork>();
  const host = new URL(res.url).hostname;
  // RIPE / APNIC / LACNIC 在网段上直接给国家；ARIN 不给，取注册人地址的最后一行
  const adr = d.entities?.find((e) => e.roles?.includes('registrant'))?.vcardArray?.[1]?.find((x) => x[0] === 'adr');
  const lastLine = adr?.[1]?.label?.split('\n').at(-1);
  return {
    country: d.country?.toUpperCase() ?? (lastLine ? codeOfCountryName(lastLine) : null),
    rir: RIR_BY_HOST.find(([k]) => host.includes(k))?.[1] ?? null,
    netname: d.name ?? null,
  };
}

export async function lookupIp(ip: string, secrets: Secrets): Promise<IpInfo | null> {
  const [a, b, registration] = await Promise.all([
    secrets.IPAPI_KEY ? fromIpapi(ip, secrets.IPAPI_KEY).catch(() => null) : null,
    fromProxycheck(ip, secrets.PROXYCHECK_KEY).catch(() => null),
    fromRdap(ip).catch(() => null),
  ]);
  const info = a && b ? merge(a, b) : (a ?? b ?? (await fromIpinfo(ip, secrets.IPINFO_TOKEN).catch(() => null)));
  return info && { ...info, registration };
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
