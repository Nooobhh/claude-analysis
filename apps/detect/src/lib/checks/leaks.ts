/*
 * 泄露检测：WebRTC（STUN 取 UDP 出口）与 DNS 解析器（借第三方权威 DNS 回显解析器 IP）。
 * 接口与解析方式改写自 MyIP（frontend/utils/dnsleaks、frontend/components/WebRtcTest.vue）。
 *
 * Portions Copyright (c) 2026 Jason Ng (https://github.com/jason5ng32/MyIP)
 * Licensed under the MIT License:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { WebrtcLeak } from '@claude-analysis/shared';
import { isMainlandIp } from '../cnip';
import { countryName, fetchWithTimeout, type Trace } from '../net';
import { flag, ip, type Detail, type Result } from '../result';
import type { Domestic } from './exits';

/**
 * 境外 STUN：UDP 没走代理时，直连 Cloudflare STUN 在国内也通，能抓到国内 IP；
 * Google STUN 国内直连不通，只有走了代理才会有结果
 */
const STUN_SERVERS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];
const STUN_TIMEOUT_MS = 5000;
const CANDIDATE_IP = /([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{0,4}){2,7})/i;

export interface WebrtcProbe {
  server: string;
  /** STUN 回显的公网 IP（srflx / prflx 候选）；null = 没拿到 */
  ip: string | null;
}

function probeStun(server: string): Promise<WebrtcProbe> {
  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let done = false;
    const finish = (ip: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        pc?.close();
      } catch {
        /* 已关闭 */
      }
      resolve({ server, ip });
    };
    const timer = setTimeout(() => finish(null), STUN_TIMEOUT_MS);
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: server }] });
      // 隐私插件可能把 RTCPeerConnection 换成空壳
      if (typeof pc.createDataChannel !== 'function') return finish(null);
      pc.onicecandidate = (e) => {
        const c = e.candidate;
        if (!c) return finish(null);
        // host 候选是本机地址（现代浏览器已用 mDNS 隐藏），只认 STUN 回显的公网地址
        if (c.type !== 'srflx' && c.type !== 'prflx') return;
        const ip = c.address ?? CANDIDATE_IP.exec(c.candidate)?.[1] ?? null;
        if (ip) finish(ip);
      };
      pc.createDataChannel('probe');
      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => finish(null));
    } catch {
      finish(null);
    }
  });
}

/** undefined = 浏览器不支持 / 禁用了 WebRTC */
export async function probeWebrtc(): Promise<WebrtcProbe[] | undefined> {
  if (typeof RTCPeerConnection !== 'function') return undefined;
  return Promise.all(STUN_SERVERS.map(probeStun));
}

export interface Resolver {
  ip: string;
  /** 国家代码；null = 该接口不提供 */
  cc: string | null;
  org: string | null;
}

export interface DnsProbe {
  provider: string;
  resolvers: Resolver[];
}

const rand = (n: number) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join('');
};

// 每次用随机子域名，逼解析器真正发起一次查询，对方的权威 DNS 记下是谁来查的
const DNS_PROVIDERS: Array<{ name: string; run: () => Promise<Resolver[]> }> = [
  {
    name: 'fastly-analytics.com',
    async run() {
      const res = await fetchWithTimeout(`https://${rand(24)}.u.fastly-analytics.com/debug_resolver`);
      const d = (await res.json()) as { dns_resolver_info?: { ip?: string; cc?: string; as_name?: string } };
      const r = d.dns_resolver_info;
      return r?.ip ? [{ ip: r.ip, cc: r.cc ?? null, org: r.as_name ?? null }] : [];
    },
  },
  {
    name: 'surfsharkdns.com',
    async run() {
      const res = await fetchWithTimeout(`https://${rand(13)}.ipv4.surfsharkdns.com`);
      const d = (await res.json()) as Record<string, { IP?: string; CountryCode?: string; ISP?: string }>;
      return Object.values(d)
        .filter((r) => r?.IP)
        .map((r) => ({ ip: r.IP!, cc: r.CountryCode ?? null, org: r.ISP ?? null }));
    },
  },
  {
    name: 'ipleak.net',
    async run() {
      const res = await fetchWithTimeout(`https://${rand(40)}-1.ipleak.net/dnsdetection/`);
      const d = (await res.json()) as { ip?: Record<string, number> };
      return Object.keys(d.ip ?? {}).map((ip) => ({ ip, cc: null, org: null }));
    },
  },
];

/** 按顺序尝试，第一个拿到解析器的接口胜出；全部失败返回 null */
export async function probeDns(): Promise<DnsProbe | null> {
  for (const p of DNS_PROVIDERS) {
    try {
      const resolvers = await p.run();
      if (resolvers.length) return { provider: p.name, resolvers };
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

// ---------- 判定（本项目规则） ----------

/**
 * WebRTC：STUN 回显的 UDP 出口与已知出口比对。不认识的 IP 可能就是宽带 IP，
 * 不发后端，只用本地的大陆 IP 段判断归属
 */
export async function judgeWebrtc(probes: WebrtcProbe[] | undefined, exits: Trace[], domestic: Domestic | null): Promise<Result> {
  if (!probes) return { status: 'ok', tag: '未启用', value: [], reason: '浏览器禁用了 WebRTC，网页拿不到 UDP 出口' };

  type Kind = 'same' | 'mainland' | 'other';
  const classify = async (x: string): Promise<{ kind: Kind; cc?: string }> => {
    const exit = exits.find((t) => t.ip === x);
    if (exit) return { kind: 'same', cc: exit.loc };
    if ((domestic?.inMainland && domestic.ip === x) || (await isMainlandIp(x))) return { kind: 'mainland', cc: 'CN' };
    return { kind: 'other' };
  };
  const seen = await Promise.all(probes.map(async (p) => ({ ...p, ...(p.ip ? await classify(p.ip) : { kind: null, cc: undefined }) })));

  const NOTE = { same: '与 Claude 出口一致', mainland: '中国大陆 IP，绕过了代理', other: '与 Claude 出口不同' };
  const details: Detail[] = seen.map((p) => ({
    label: p.server.replace(/^stun:/, '').replace(/:\d+$/, ''),
    value: p.ip ? [...flag(p.cc), ip(p.ip)] : ['无结果'],
    status: p.kind === 'mainland' ? 'bad' : p.kind === 'other' ? 'warn' : undefined,
    note: p.kind ? NOTE[p.kind] : 'UDP 没有响应',
  }));
  // 出口 IP 列：去重后的 UDP 出口
  const uniq = [...new Map(seen.filter((p) => p.ip).map((p) => [p.ip, p])).values()];
  const value = uniq.length ? uniq.flatMap((p, i) => [...(i ? [' '] : []), ...flag(p.cc), ip(p.ip!)]) : ['—'];
  if (!uniq.length) return { status: 'ok', tag: '未泄露', value, reason: 'UDP 被阻断或 WebRTC 受限，网页拿不到你的 IP', details };
  if (seen.some((p) => p.kind === 'mainland')) {
    return { status: 'bad', tag: '泄露国内 IP', value, reason: 'WebRTC 绕过代理暴露了中国大陆 IP，任何网页脚本都能读到', details };
  }
  if (seen.some((p) => p.kind === 'other')) {
    return { status: 'warn', tag: '可能泄露', value, reason: 'UDP 出口与 Claude 出口不同，网页能通过 WebRTC 看到另一个 IP', details };
  }
  return { status: 'ok', tag: '未泄露', value, reason: 'UDP 出口与 Claude 出口一致', details };
}

/** 结果码用：WebRTC 判定 → 泄露类型（judgeWebrtc 只在泄露大陆 IP 时标 bad、其他出口时标 warn） */
export function webrtcLeakOf(probes: WebrtcProbe[] | undefined, r: Result): WebrtcLeak {
  if (!probes) return 'disabled';
  return r.status === 'bad' ? 'mainland' : r.status === 'warn' ? 'other' : 'none';
}

/** 结果码用：DNS 解析器所在国家（去重）；检测失败为 null */
export const dnsCountriesOf = (probe: DnsProbe | null): string[] | null =>
  probe ? [...new Set(probe.resolvers.flatMap((r) => (r.cc ? [r.cc.toUpperCase()] : [])))] : null;

export function judgeDns(probe: DnsProbe | null): Result {
  if (!probe) return { status: 'unknown', tag: '检测失败', value: ['—'], reason: 'DNS 检测接口都没有返回' };
  const { resolvers, provider } = probe;
  const levelOf = (cc: string | null) => (cc === 'CN' ? 'bad' : cc === 'HK' || cc === 'MO' ? 'warn' : undefined);
  // 出口 IP 列只放第一个解析器，逐个结果进泄露卡片
  const first = resolvers[0];
  const value = [...flag(first.cc), ip(first.ip), resolvers.length > 1 ? ` 等 ${resolvers.length} 个` : ''];
  const details: Detail[] = resolvers.map((r) => ({
    label: r.org ?? '运营商未知',
    value: [...flag(r.cc), ip(r.ip)],
    status: levelOf(r.cc),
    note: r.cc ? countryName(r.cc) : '位置未知',
  }));
  const who = resolvers.length === 1 && first.org ? `${first.org} · ` : '';
  const source = `数据来源 ${provider}`;
  if (resolvers.some((r) => r.cc === 'CN')) {
    return { status: 'bad', tag: '国内解析器', value, reason: `${who}DNS 查询经国内解析器发出，Claude 所在的 Cloudflare 能看到来自中国的查询 · ${source}`, details };
  }
  if (!resolvers.some((r) => r.cc)) return { status: 'unknown', tag: '无法判断', value, reason: `${who}该接口不提供解析器所在地 · ${source}`, details };
  if (resolvers.some((r) => r.cc === 'HK' || r.cc === 'MO')) {
    return { status: 'warn', tag: '港澳解析器', value, reason: `${who}有解析器位于香港 / 澳门 · ${source}`, details };
  }
  return { status: 'ok', tag: '未泄露', value, reason: `${who}未发现国内解析器 · ${source}`, details };
}
