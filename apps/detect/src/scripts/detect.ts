// 检测页入口：并行跑各项检测，结果到一项渲染一项；全部在浏览器本地完成，
// 只有 Claude 出口 IP 会发给本站 Worker 查属性（见 lib/checks/ipinfo.ts）
import {
  RESULT_CODE_TTL,
  STATUS_LABEL,
  composeResultCode,
  type CheckId,
  type LocalSnapshot,
  type Status,
} from '@claude-analysis/shared';
import { ANTHROPIC_DOMAINS, CHECKS, REPORT_GROUPS, anchorOf } from '../lib/catalog';
import { fetchStatus, judgeLatency, judgeStatus } from '../lib/checks/availability';
import { getDomestic, judgeConsistency, judgeDomestic, judgeDrift, judgeExit, judgeProxied } from '../lib/checks/exits';
import {
  browserFamily,
  checkBrowser,
  checkDevice,
  checkFonts,
  checkLanguage,
  checkLocale,
  checkTimezone,
  osFamily,
  readFingerprint,
  type Fingerprint,
} from '../lib/checks/fingerprint';
import {
  fetchIpInfo,
  infoOf,
  judgeAsn,
  judgeCrossLanguage,
  judgeCrossTimezone,
  judgeFlag,
  judgeLocation,
  judgeNative,
  judgeOrg,
  judgeRegion,
  judgeScore,
  judgeType,
} from '../lib/checks/ipinfo';
import { dnsCountriesOf, judgeDns, judgeWebrtc, probeDns, probeWebrtc, webrtcLeakOf } from '../lib/checks/leaks';
import { flagUrl } from '../lib/flags';
import { countryName, delay, getTrace, maskIp, type Trace } from '../lib/net';
import type { Detail, Part, Result } from '../lib/result';

const DRIFT_SAMPLES = 5;
const DRIFT_INTERVAL_MS = 2000;
const API_SAMPLES = 3;

const results = new Map<CheckId, Result>();
let showIp = false;
let runId = 0;

/** 结果码要用、但 results 里没有的原始结论，随检测逐项填入 */
interface CodeFacts {
  fp: Fingerprint | null;
  /** /api/ip 是否查到了 IP 属性 */
  ipQueried: boolean;
  /** /api/ip 返回的签名段；IP 属性没查到或服务器没配私钥时为空 */
  signed?: string;
  signedAt: number;
  exitCountry: string | null;
  webrtc: LocalSnapshot['leak']['webrtc'];
  dnsCountries: string[] | null;
}
const emptyFacts = (): CodeFacts => ({ fp: null, ipQueried: false, signedAt: 0, exitCountry: null, webrtc: 'none', dnsCountries: null });
let facts = emptyFacts();

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);

// ---------- 渲染 ----------

function ipNode(value: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ip';
  el.dataset.ip = value;
  el.textContent = showIp ? value : maskIp(value);
  return el;
}

function flagNode(cc: string): HTMLElement[] {
  const url = flagUrl(cc);
  if (!url) return [];
  const img = document.createElement('img');
  img.className = 'flag';
  img.src = url;
  img.alt = cc;
  img.title = countryName(cc);
  img.decoding = 'async';
  return [img];
}

const renderParts = (parts: Part[]): Node[] =>
  parts.flatMap((p): Node[] => {
    if (typeof p === 'string') return p ? [document.createTextNode(p)] : [];
    return 'ip' in p ? [ipNode(p.ip)] : flagNode(p.flag);
  });

function setTag(el: HTMLElement, status: Status | undefined, text: string | undefined) {
  const label = text ?? (status ? STATUS_LABEL[status] : undefined);
  el.hidden = !label;
  el.dataset.status = status ?? 'neutral';
  el.textContent = label ?? '';
}

function renderDetail(d: Detail): HTMLElement {
  const el = document.createElement('dd');
  if (d.status) el.dataset.status = d.status;
  el.append(...renderParts(d.value));
  return el;
}

function renderRow(id: CheckId) {
  const root = $(`[data-check="${id}"]`);
  if (!root) return;
  const value = $('.check__value', root)!;
  const reason = $('.check__reason', root)!;
  const tag = $('.tag', root)!;
  const details = $<HTMLDetailsElement>('.details', root);
  const r = results.get(id);

  if (!r) {
    value.innerHTML = '<span class="skeleton"></span>';
    reason.hidden = true;
    if (details) details.hidden = true;
    tag.hidden = false;
    tag.dataset.status = 'pending';
    tag.textContent = '检测中';
    return;
  }

  value.replaceChildren(...renderParts(r.value));
  reason.hidden = !r.reason;
  reason.textContent = r.reason ?? '';
  setTag(tag, r.status, r.tag);

  if (details) {
    details.hidden = !r.details?.length;
    if (r.details?.length) {
      $('summary', details)!.textContent = `明细（${r.details.length}）`;
      $('dl', details)!.replaceChildren(
        ...r.details.flatMap((d) => {
          const dt = document.createElement('dt');
          dt.textContent = d.label;
          return [dt, renderDetail(d)];
        }),
      );
    }
  }
}

function counts(): Record<Status, number> {
  const c: Record<Status, number> = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const r of results.values()) if (r.status) c[r.status]++;
  return c;
}

const groupOf = new Map(REPORT_GROUPS.flatMap((g) => g.checks.map((c) => [c.id, g.title] as const)));

/** 「发现的问题」：异常在前、注意在后，按页面顺序；点击跳到对应检测项 */
function renderIssues(finished: boolean) {
  const rank: Partial<Record<Status, number>> = { bad: 0, warn: 1 };
  const hits = CHECKS.flatMap((c) => {
    const r = results.get(c.id);
    return r?.status && rank[r.status] !== undefined ? [{ c, r, rank: rank[r.status]! }] : [];
  }).sort((a, b) => a.rank - b.rank);

  const list = $('#issues-list')!;
  const empty = $('#issues-empty')!;
  $('#issues')!.hidden = !hits.length && !finished;
  empty.hidden = !!hits.length;
  list.replaceChildren(
    ...hits.map(({ c, r }) => {
      const a = document.createElement('a');
      a.className = 'issue';
      a.href = `#${anchorOf(c.id)}`;
      const tag = document.createElement('span');
      tag.className = 'tag';
      setTag(tag, r.status, undefined);
      const title = document.createElement('span');
      title.className = 'issue__title';
      title.textContent = `${groupOf.get(c.id)} · ${c.label}${r.tag ? `：${r.tag}` : ''}`;
      const reason = document.createElement('span');
      reason.className = 'issue__reason';
      reason.textContent = r.reason ?? '';
      a.append(tag, title, reason);
      return a;
    }),
  );
}

function renderSummary() {
  const c = counts();
  for (const status of ['bad', 'warn', 'ok', 'unknown'] as const) {
    const num = $(`[data-count="${status}"]`)!;
    num.textContent = String(c[status]);
    num.closest<HTMLElement>('.stat')!.dataset.zero = String(c[status] === 0);
  }
  $('.stat[data-status="unknown"]')!.hidden = c.unknown === 0;

  const done = results.size;
  const total = CHECKS.length;
  const finished = done === total;
  const bar = $('#progress')!;
  bar.style.width = `${(done / total) * 100}%`;
  bar.style.opacity = finished ? '0' : '1';
  const label = $('#progress-label')!;
  label.textContent = finished ? '检测完成' : `检测中 ${done}/${total}`;
  renderIssues(finished);
  if (finished) $('#announce')!.textContent = `检测完成：异常 ${c.bad} 项，注意 ${c.warn} 项`;
}

// ---------- 检测调度 ----------

async function run() {
  const my = ++runId;
  const put = (id: CheckId, r: Result) => {
    if (my !== runId) return;
    results.set(id, r);
    renderRow(id);
    renderSummary();
  };

  results.clear();
  CHECKS.forEach((c) => renderRow(c.id));
  renderSummary();
  $('#announce')!.textContent = '';
  const rerun = $<HTMLButtonElement>('#rerun')!;
  rerun.disabled = true;

  // 环境指纹：同步读取
  const fp = readFingerprint();
  facts = { ...emptyFacts(), fp };
  const note = (patch: Partial<CodeFacts>) => {
    if (my === runId) Object.assign(facts, patch);
  };
  put('fp.timezone', checkTimezone(fp));
  put('fp.language', checkLanguage(fp));
  put('fp.locale', checkLocale(fp));
  put('fp.fonts', checkFonts());
  put('fp.browser', checkBrowser());
  const deviceP = checkDevice().then((r) => put('fp.device', r));

  // 出口 IP：各域名 trace 并行
  const traces = ANTHROPIC_DOMAINS.map((host) => getTrace(host));
  const [claudeP, apiP] = traces;
  const allTracesP = Promise.all(traces);
  const domesticP = getDomestic();

  const exitsP = Promise.all([
    claudeP.then((t) => put('exit.claude', judgeExit(t, 'claude.ai'))),
    apiP.then((t) => put('exit.api', judgeExit(t, 'api.anthropic.com'))),
    Promise.all([domesticP, claudeP]).then(([d, c]) => put('exit.domestic', judgeDomestic(d, c))),
    Promise.all([claudeP, domesticP]).then(([c, d]) => put('exit.proxied', judgeProxied(c, d))),
    allTracesP.then((all) => put('exit.consistency', judgeConsistency(ANTHROPIC_DOMAINS.map((host, i) => [host, all[i]])))),
  ]);

  // 漂移与延迟：claude.ai 间隔 2 秒再采样，api.anthropic.com 连续再采样
  const sample = async (first: Promise<Trace | null>, host: string, n: number, gap: number) => {
    const list = [await first];
    for (let i = 1; i < n; i++) {
      await delay(gap);
      list.push(await getTrace(host));
    }
    return list;
  };
  const timingP = Promise.all([
    sample(claudeP, 'claude.ai', DRIFT_SAMPLES, DRIFT_INTERVAL_MS).then((s) => {
      put('exit.drift', judgeDrift(s));
      put('avail.claude', judgeLatency(s));
    }),
    sample(apiP, 'api.anthropic.com', API_SAMPLES, 300).then((s) => put('avail.api', judgeLatency(s))),
  ]);

  // IP 属性与风险：只查 claude.ai 出口（失败时退到 api.anthropic.com 出口）
  const ipP = Promise.all([claudeP, apiP]).then(async ([c, a]) => {
    const target = (c ?? a)?.ip;
    const r = target ? await fetchIpInfo(target) : null;
    const cc = (c ?? a)?.loc || infoOf(r)?.countryCode || undefined;
    note({ exitCountry: cc ?? null, ipQueried: !!r?.ok, ...(r?.ok && r.signed ? { signed: r.signed, signedAt: Date.now() } : {}) });
    put('ip.region', judgeRegion(cc));
    put('ip.native', judgeNative(r, cc));
    put('ip.type', judgeType(r));
    put('ip.asn', judgeAsn(r));
    put('ip.org', judgeOrg(r));
    put('ip.location', judgeLocation(r));
    put('ip.vpn', judgeFlag(r, 'vpn'));
    put('ip.proxy', judgeFlag(r, 'proxy'));
    put('ip.tor', judgeFlag(r, 'tor'));
    put('ip.abuser', judgeFlag(r, 'abuser'));
    put('ip.score', judgeScore(r));
    put('cross.timezone', judgeCrossTimezone(fp, r));
    put('cross.language', judgeCrossLanguage(fp, cc));
  });

  // 泄露
  const webrtcP = Promise.all([probeWebrtc(), allTracesP, domesticP]).then(async ([p, all, d]) => {
    const r = await judgeWebrtc(p, all.filter((t): t is Trace => t !== null), d);
    put('leak.webrtc', r);
    note({ webrtc: webrtcLeakOf(p, r) });
  });
  const dnsP = probeDns().then((p) => {
    put('leak.dns', judgeDns(p));
    note({ dnsCountries: dnsCountriesOf(p) });
  });

  const statusP = fetchStatus().then((s) => put('avail.status', judgeStatus(s)));

  await Promise.allSettled([deviceP, exitsP, timingP, ipP, webrtcP, dnsP, statusP]);
  if (my === runId) rerun.disabled = false;
}

// ---------- 复制报告（IP 一律打码，国内出口整项不写入） ----------

const partsText = (parts: Part[]) =>
  parts.map((p) => (typeof p === 'string' ? p : 'ip' in p ? maskIp(p.ip) : '')).join('').trim();

function buildReport(): string {
  const c = counts();
  const lines = [
    'Claude 使用环境检测报告（IP 已打码）',
    new Date().toLocaleString('zh-CN', { hour12: false }),
    `异常 ${c.bad} · 注意 ${c.warn} · 正常 ${c.ok}${c.unknown ? ` · 未知 ${c.unknown}` : ''}`,
  ];
  for (const group of REPORT_GROUPS) {
    lines.push('', `【${group.title}】`);
    for (const check of group.checks) {
      const r = results.get(check.id);
      if (!r) continue;
      const head = `[${r.status ? STATUS_LABEL[r.status] : '信息'}]`;
      if (check.id === 'exit.domestic') {
        lines.push(`${head} ${check.label}：已检测（报告不含国内 IP）`);
        continue;
      }
      const body = [r.tag, partsText(r.value)].filter(Boolean).join(' · ') || '—';
      lines.push(`${head} ${check.label}：${body}${r.reason ? `（${r.reason}）` : ''}`);
      if (r.status === 'bad' || r.status === 'warn') {
        for (const d of r.details ?? []) if (d.status) lines.push(`    ${d.label}：${partsText(d.value)}`);
      }
    }
  }
  lines.push('', `检测地址：${location.origin}`);
  return lines.join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文或权限被拒时退回 execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---------- 结果码（在本地拼装后复制，不发送任何数据） ----------

/** 检测项报出的国产浏览器 / 设备名 */
function cnNameOf(id: CheckId): string | null {
  const r = results.get(id);
  return r?.status === 'warn' && typeof r.value[0] === 'string' ? r.value[0] : null;
}

function buildLocal(fp: Fingerprint, btn: HTMLElement): LocalSnapshot {
  return {
    version: btn.dataset.version ?? '',
    commit: btn.dataset.commit ?? '',
    status: Object.fromEntries([...results].flatMap(([id, r]) => (r.status ? [[id, r.status]] : []))) as LocalSnapshot['status'],
    exitCountry: facts.exitCountry,
    fp: {
      timezone: fp.timezone,
      offsetMin: fp.offsetMin,
      languages: fp.languages.slice(0, 3),
      locale: fp.locale,
      cnFonts: results.get('fp.fonts')?.status === 'warn',
      cnBrowser: cnNameOf('fp.browser'),
      cnDevice: cnNameOf('fp.device'),
      os: osFamily(),
      browser: browserFamily(),
    },
    leak: { webrtc: facts.webrtc, dnsCountries: facts.dnsCountries },
  };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  const el = $('#toast')!;
  el.textContent = text;
  el.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.dataset.show = 'false'), 1600);
}

// ---------- 初始化 ----------

$('#toggle-ip')?.addEventListener('click', (e) => {
  showIp = !showIp;
  (e.currentTarget as HTMLElement).setAttribute('aria-checked', String(showIp));
  document.querySelectorAll<HTMLElement>('.ip').forEach((el) => {
    el.textContent = showIp ? el.dataset.ip! : maskIp(el.dataset.ip!);
  });
});

$('#rerun')?.addEventListener('click', () => void run());

$('#copy-code')?.addEventListener('click', async (e) => {
  if (results.size < CHECKS.length || !facts.fp) return toast('还在检测，稍等几秒');
  if (!facts.signed) return toast(facts.ipQueried ? '结果码功能暂时不可用' : '没有查到 IP 属性，生成不了结果码，请重新检测');
  // 留 1 分钟余量给粘贴
  if (Date.now() - facts.signedAt > (RESULT_CODE_TTL - 60) * 1000) return toast('检测已超过 1 小时，请重新检测后再复制');
  const code = composeResultCode(facts.signed, buildLocal(facts.fp, e.currentTarget as HTMLElement));
  toast((await copyText(code)) ? '已复制结果码，回到问卷粘贴' : '复制失败，请再点一次');
});

$('#copy')?.addEventListener('click', async () => {
  if (results.size < CHECKS.length) return toast('还在检测，稍等几秒');
  toast((await copyText(buildReport())) ? '已复制检测报告' : '复制失败，请手动截图');
});

void run();
