// 看板页：读 /api/board 的份数，在浏览器里把每份问卷画成一个点。
// 点在象限内的位置是按固定种子铺开的，没有含义；浏览器拿不到任何单份问卷
import { countryName } from '../lib/countries';
import {
  BOARD_VERSION,
  MIN_N,
  bannedEver,
  total,
  wilson,
  type BoardData,
  type BoardDim,
  type BoardGroup,
  type BoardResponse,
  type BoardSection,
  type Counts,
  type PairDim,
  type QuadKey,
} from '../lib/board';

const root = document.querySelector<HTMLElement>('#board')!;
const meta = document.querySelector<HTMLElement>('#meta')!;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (x: number) => Math.round(x * 100);
const LOW = '<span class="tag" data-status="neutral">低样本</span>';

/** 固定种子的随机数：每次打开布局都一样 */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 份数 → 点：先封禁、再恢复、最后正常 */
const pips = (c: Pick<Counts, 'banned' | 'restored'> & { active?: number }) =>
  '<span class="pip b"></span>'.repeat(c.banned) +
  '<span class="pip r"></span>'.repeat(c.restored) +
  '<span class="pip a"></span>'.repeat(c.active ?? 0);

/** 被封过的占比 + 区间；少于 MIN_N 份加「低样本」 */
function share(c: Counts) {
  const n = total(c), k = bannedEver(c);
  const [lo, hi] = wilson(k, n);
  return { p: pct(k / n), lo: pct(lo), hi: pct(hi), low: n < MIN_N, n, k };
}

// ---------- 散点图 ----------

const QUADS: Record<QuadKey, { k: string; t: string; area: [number, number, number, number]; pos: string }> = {
  cv: { k: '环境干净 · 有违规项', t: '行为造成的封禁', area: [0, 0.5, 0.5, 1], pos: 'tl' },
  cc: { k: '环境干净 · 行为干净', t: '基线', area: [0, 0.5, 0, 0.5], pos: 'bl' },
  pv: { k: '环境有问题 · 有违规项', t: '两方面都有问题', area: [0.5, 1, 0.5, 1], pos: 'tr' },
  pc: { k: '环境有问题 · 行为干净', t: '环境造成的封禁', area: [0.5, 1, 0, 0.5], pos: 'br' },
};
const ASPECT = 1 / 0.82;

/** 在矩形（0–1 坐标，y 向上）里铺 n 个点：抖动网格，避免重叠 */
function scatter(n: number, [x0, x1, y0, y1]: [number, number, number, number], rand: () => number): Array<[number, number]> {
  if (!n) return [];
  const pad = 0.08, w = (x1 - x0) * (1 - 2 * pad), h = (y1 - y0) * (1 - 2 * pad);
  const cols = Math.max(1, Math.round(Math.sqrt((n * w * ASPECT) / h)));
  const rows = Math.ceil(n / cols);
  const slots: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push([c, r]);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots.slice(0, n).map(([c, r]) => [
    x0 + (x1 - x0) * pad + (w / cols) * (c + 0.5 + (rand() - 0.5) * 0.7),
    y0 + (y1 - y0) * pad + (h / rows) * (r + 0.5 + (rand() - 0.5) * 0.7),
  ]);
}

function heroChart(d: BoardData): string {
  // 点固定大小，不随份数变
  const size = 8;
  const rand = rng(11);
  let dots = '';
  for (const [key, q] of Object.entries(QUADS) as Array<[QuadKey, (typeof QUADS)[QuadKey]]>) {
    const c = d.quad[key];
    // 状态打乱后再铺，颜色比例就是占比
    const states = ['b', 'r', 'a'].flatMap((s, i) => Array<string>([c.banned, c.restored, c.active][i]).fill(s));
    for (let i = states.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [states[i], states[j]] = [states[j], states[i]];
    }
    scatter(states.length, q.area, rand).forEach(([x, y], i) => {
      dots += `<span class="dot ${states[i]}" style="left:${x * 100}%;top:${(1 - y) * 100}%;width:${size}px;height:${size}px"></span>`;
    });
  }
  const note = (key: QuadKey) => {
    const q = QUADS[key], c = d.quad[key], n = total(c);
    const main = n
      ? (() => {
          const s = share(c);
          return `<div class="note__big">${s.p}<small>%</small>${s.low ? ` ${LOW}` : ''}</div><div class="note__lab">被封过 · 区间 ${s.lo}–${s.hi}%</div>`;
        })()
      : '<div class="note__big note__big--empty">还没有问卷</div>';
    return `<div class="note note--${q.pos}" data-q="${key}"><div class="note__k">${q.k}</div><div class="note__t">${q.t}</div>${main}
      <div class="note__rows">${n} 份<br>${c.banned}<i class="sw-banned"></i>封禁<br>${c.restored}<i class="sw-restored"></i>恢复<br>${c.active}<i class="sw-active"></i>正常</div></div>`;
  };
  const summary = (Object.keys(QUADS) as QuadKey[]).map((k) => `${QUADS[k].t} ${total(d.quad[k])} 份，被封过 ${bannedEver(d.quad[k])} 份`).join('；');
  return `<section class="hc" id="hc">
    <div class="hc__head">${legend()}<span class="hc__hint">一个点 = 一份问卷 · 象限内的位置没有含义</span></div>
    <div class="hc__grid">${note('cv')}${note('cc')}
      <div class="hc__chart"><div class="chart">
        <div class="chart__y" aria-hidden="true"><span>有违规项</span><span>行为干净</span></div>
        <div class="plot" id="plot" role="img" aria-label="${esc(summary)}">
          <div class="plot__key" style="left:0;top:0"></div><div class="plot__key" style="left:50%;top:50%"></div>
          <div class="plot__v"></div><div class="plot__h"></div>${dots}
        </div>
        <div class="chart__x" aria-hidden="true"><span>环境干净</span><span>环境有问题</span></div>
      </div></div>
      ${note('pv')}${note('pc')}</div>
    <p class="hc__foot">另有 <span class="mono">${d.undetermined}</span> 份环境或行为无法判定，没画进图里。</p>
  </section>`;
}

const legend = () =>
  '<div class="legend"><span><i class="sw-banned"></i>已被封禁</span><span><i class="sw-restored"></i>申诉恢复</span><span><i class="sw-active"></i>正常使用</span></div>';

// ---------- 三块：账号情况 / 网络环境 / 使用习惯 ----------

function dimHtml(d: BoardDim): string {
  const rows = d.rows
    .map((r) => {
      const s = share(r.c);
      const label = d.country && r.key !== 'other' ? countryName(r.key) : r.label;
      return `<div class="srow"><div class="srow__lab">${esc(label)}<small>${s.n} 份</small></div><div class="pips">${pips(r.c)}</div>
        <div class="srow__st"><b>${s.p}%</b> ${s.low ? LOW : '被封'}<small>${s.lo}–${s.hi}%</small></div></div>`;
    })
    .join('');
  return `<div class="dim"><div class="dim__t"><span class="dim__q">${esc(d.q)}</span>${esc(d.title)}${d.multi ? '<span class="dim__meta">多选，每项单独算</span>' : ''}</div>${rows}</div>`;
}

const groupsHtml = (groups: BoardGroup[]) =>
  groups.length
    ? groups
        .map((g) => `<div class="group"><div class="group__t">${esc(g.title)}${g.desc ? ` <span>· ${esc(g.desc)}</span>` : ''}</div>${g.dims.map(dimHtml).join('')}</div>`)
        .join('')
    : '<p class="part__empty">这个范围里还没有问卷。</p>';

const icon = (on: boolean[]) => `<span class="qicon" aria-hidden="true">${on.map((x) => `<i${x ? ' class="on"' : ''}></i>`).join('')}</span>`;

interface PartDef {
  id: 'network' | 'usage';
  title: string;
  scopeName: string;
  /** 小象限图标：左上、右上、左下、右下 */
  icon: boolean[];
  desc: string;
}

const PARTS: PartDef[] = [
  { id: 'network', title: '网络环境', scopeName: '行为干净', icon: [false, false, true, true], desc: '只看行为干净的账号，也就是散点图的下半边：没有违规项仍被封，更可能和网络、设备有关。' },
  { id: 'usage', title: '使用习惯', scopeName: '环境干净', icon: [true, false, true, false], desc: '只看环境干净的账号，也就是散点图的左半边：环境没问题仍被封，更可能和怎么用有关。' },
];

function partBody(p: PartDef, sec: BoardSection, scope: 'scoped' | 'all'): string {
  const { total: t, groups } = sec[scope];
  const n = total(t);
  const lead = scope === 'scoped' ? p.desc : '全部样本：没有按环境或行为筛选，各组混在一起，差异可能来自另一方面。';
  const overall = n ? `这部分整体被封 <b class="mono">${pct(bannedEver(t) / n)}%</b>（${bannedEver(t)} / ${n}）。` : '';
  return `<p class="part__desc">${lead}${overall}</p>${groupsHtml(groups)}`;
}

function partHtml(p: PartDef, sec: BoardSection): string {
  const btn = (scope: 'scoped' | 'all', name: string) =>
    `<button type="button" data-scope="${scope}" aria-pressed="${scope === 'scoped'}">${name} · <span class="mono">${total(sec[scope].total)}</span> 份</button>`;
  return `<section class="part" data-part="${p.id}">
    <div class="part__head">${icon(p.icon)}<h2>${p.title}</h2>
      <div class="seg" role="group" aria-label="统计范围">${btn('scoped', p.scopeName)}${btn('all', '全部')}</div></div>
    <div class="part__body">${partBody(p, sec, 'scoped')}</div>
  </section>`;
}

// ---------- 账号情况：注册、封禁情况、账号来历 ----------

/** 最多显示 12 个月，更早的并成一列 */
function timelineCols(d: BoardData) {
  const list = d.timeline.map((m) => ({ label: `${Number(m.month.slice(5))} 月`, title: m.month, banned: m.banned, restored: m.restored }));
  if (list.length <= 12) return list;
  const early = list.slice(0, list.length - 11);
  return [
    { label: '更早', title: `${early[0].title} 至 ${early.at(-1)!.title}`, banned: early.reduce((s, m) => s + m.banned, 0), restored: early.reduce((s, m) => s + m.restored, 0) },
    ...list.slice(-11),
  ];
}

function timelineHtml(d: BoardData, width: number, ps: number, pg: number): string {
  const cols = timelineCols(d);
  if (!cols.length) return '<p class="part__empty">还没有被封的账号。</p>';
  const max = Math.max(...cols.map((c) => c.banned + c.restored));
  // 每列几个点宽：放得下就 4 个，所有月份都不超过 20 个时 1 个
  const fit = Math.max(1, Math.floor((width / cols.length - 10 + pg) / (ps + pg)));
  const w = max <= 20 ? 1 : Math.min(4, fit);
  return `<div class="tl">${cols
    .map(
      (c) =>
        `<div class="tl__col" title="${c.title}：${c.banned + c.restored} 个账号被封"><span class="tl__v">${c.banned + c.restored}</span><div class="tl__stack" style="--w:${w}">${pips(c)}</div><span class="tl__m">${c.label}</span></div>`,
    )
    .join('')}</div>`;
}

function pairHtml(p: PairDim): string {
  const sum = (g: 'clean' | 'problem') => p.rows.reduce((s, r) => s + bannedEver(r[g]), 0);
  const col = (g: 'clean' | 'problem', title: string) => {
    const n = sum(g);
    return `<div><h4>${title} <span>· ${n} 个被封账号</span></h4>${p.rows
      .map((r) => `<div class="barow"><span>${esc(r.label)}</span><span class="pips">${pips(r[g])}</span><span class="barow__p">${n ? pct(bannedEver(r[g]) / n) : 0}%</span></div>`)
      .join('')}</div>`;
  };
  const body = p.rows.length ? `<div class="ba">${col('clean', '环境干净')}${col('problem', '环境有问题')}</div>` : '<p class="part__empty">还没有数据。</p>';
  return `<div class="sub"><h3><span class="dim__q">${p.q}</span>${p.title}</h3>${body}</div>`;
}

/** 只有被封的账号答的题：分布，右侧写占被封账号的比例 */
function distHtml(d: BoardDim): string {
  const n = d.base ?? 0;
  return `<div class="sub"><h3><span class="dim__q">${esc(d.q)}</span>${esc(d.title)}${d.multi ? '<span class="dim__meta">多选</span>' : ''}<span class="dim__meta">${n} 个被封账号答了</span></h3>${d.rows
    .map((r) => `<div class="barow"><span>${esc(r.label)}</span><span class="pips">${pips(r.c)}</span><span class="barow__p">${n ? pct(bannedEver(r.c) / n) : 0}%</span></div>`)
    .join('')}</div>`;
}

function accountHtml(d: BoardData): string {
  const [reg, ...rest] = d.account.groups;
  const [banAfter, banReason] = d.byEnv;
  return `<section class="part" data-part="account">
    <div class="part__head">${icon([true, true, true, true])}<h2>账号情况</h2></div>
    <p class="part__desc">全部样本。账号状态、注册与被封的经过，以及账号的来历。</p>
    ${reg ? groupsHtml([reg]) : ''}
    <div class="group">
      <div class="group__t">封禁情况 <span>· 只看被封过的账号</span></div>
      <div class="sub"><h3><span class="dim__q">B1</span>封禁时间线</h3>
        <p class="part__desc">每个点是一个被封过的账号，按封禁月份堆起来。某个月突然变高，可能是一波封号潮。</p>
        <div id="timeline"></div></div>
      <p class="part__desc part__desc--sub">下面两项把被封的账号按环境分成两组：如果环境有问题的一组集中在前几档，说明地区问题封得更快；封禁通知里写的原因也可以拿来对照分组。</p>
      ${pairHtml(banAfter)}${pairHtml(banReason)}
      ${banReason.rows.length ? '' : '<p class="part__note">「封禁通知里写的原因」是问卷第 2 版新增的题，早期问卷可以回去补答。</p>'}
      ${d.bannedDists.map(distHtml).join('')}
    </div>
    ${groupsHtml(rest)}
  </section>`;
}

// ---------- 目录 ----------

const toc = document.querySelector<HTMLElement>('#toc')!;

/** 按实际渲染出来的部分生成目录：散点图、三块（含各组）、判定说明 */
function renderToc() {
  type Item = { el: HTMLElement; label: string; children?: Item[] };
  const items: Item[] = [{ el: root.querySelector<HTMLElement>('#hc')!, label: '环境 × 行为' }];
  root.querySelectorAll<HTMLElement>('.part').forEach((part) => {
    part.id = `part-${part.dataset.part}`;
    const children = [...part.querySelectorAll<HTMLElement>('.group')].map((g, i) => {
      g.id = `${part.id}-${i}`;
      // 组标题只取名字，去掉「· 说明」
      return { el: g, label: g.querySelector('.group__t')!.firstChild!.textContent!.trim() };
    });
    items.push({ el: part, label: part.querySelector('h2')!.textContent!, children });
  });
  items.push({ el: document.querySelector<HTMLElement>('#rules')!, label: '怎么判定' });

  const link = (it: Item, sub: boolean) => `<a class="toc__link${sub ? ' toc__link--sub' : ''}" href="#${it.el.id}">${esc(it.label)}</a>`;
  toc.innerHTML = `<p class="toc__title">目录</p>${items
    .map((it) => `<div class="toc__item">${link(it, false)}${it.children?.map((c) => link(c, true)).join('') ?? ''}</div>`)
    .join('')}`;
  toc.hidden = false;

  tocTargets = items.flatMap((it) => [it.el, ...(it.children?.map((c) => c.el) ?? [])]);
  updateToc();
}

let tocTargets: HTMLElement[] = [];

/** 高亮当前读到的部分：顶部越过阅读线的最后一个（小节在所属大块之后，所以小节优先）；滚到底时取最后一个 */
function updateToc() {
  if (!tocTargets.length) return;
  // 阅读线 = 跳转后标题停的位置（scroll-margin-top）再往下一点
  const line = parseFloat(getComputedStyle(tocTargets[0]).scrollMarginTop) + 8;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  const current = atBottom ? tocTargets.at(-1)! : (tocTargets.filter((el) => el.getBoundingClientRect().top <= line).at(-1) ?? tocTargets[0]);
  toc.querySelectorAll<HTMLAnchorElement>('.toc__link').forEach((a) => a.toggleAttribute('aria-current', a.hash === `#${current.id}`));
  // 小节高亮时，所在大块也高亮
  toc.querySelectorAll('.toc__item').forEach((item) => item.querySelector('.toc__link')!.toggleAttribute('data-parent', !!item.querySelector('[aria-current]')));
}

window.addEventListener('scroll', updateToc, { passive: true });

// 点「怎么判定」时展开说明
toc.addEventListener('click', (e) => {
  if ((e.target as HTMLAnchorElement).hash === '#rules') document.querySelector<HTMLDetailsElement>('#rules')!.open = true;
});

// ---------- 渲染 ----------

let data: BoardData | null = null;

function sizes(d: BoardData) {
  return d.total <= 100 ? { ps: 10, pg: 3 } : { ps: 6, pg: 2 };
}

function renderTimeline() {
  if (!data) return;
  const box = root.querySelector<HTMLElement>('#timeline')!;
  const { ps, pg } = sizes(data);
  box.innerHTML = timelineHtml(data, box.clientWidth, ps, pg);
}

function render(d: BoardData) {
  const { ps, pg } = sizes(d);
  root.style.setProperty('--ps', `${ps}px`);
  root.style.setProperty('--pg', `${pg}px`);
  meta.innerHTML = `已收集 <b class="mono">${d.total}</b> 份 · 检测站带入 <b class="mono">${d.detect}</b> 份 · 样本偏向被封者，只做组间对比 · 更新于 ${d.updatedOn}`;
  if (!d.total) {
    root.innerHTML = '<p class="part__empty">还没有问卷数据。</p>';
    root.hidden = false;
    return;
  }
  root.innerHTML = heroChart(d) + accountHtml(d) + PARTS.map((p) => partHtml(p, d[p.id])).join('');
  root.hidden = false;
  renderTimeline();
  renderToc();
}

// 范围切换
root.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-scope]');
  if (!btn || !data) return;
  const part = btn.closest<HTMLElement>('[data-part]')!;
  const def = PARTS.find((p) => p.id === part.dataset.part)!;
  const scope = btn.dataset.scope as 'scoped' | 'all';
  part.querySelectorAll('[data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  part.querySelector('.part__body')!.innerHTML = partBody(def, data[def.id], scope);
});

// 悬停象限：突出对应的注释
root.addEventListener('mousemove', (e) => {
  const plot = (e.target as Element).closest<HTMLElement>('#plot');
  const hc = root.querySelector<HTMLElement>('#hc');
  if (!hc) return;
  if (!plot) return hc.classList.remove('hovering');
  const r = plot.getBoundingClientRect();
  const q = (e.clientX - r.left < r.width / 2 ? 'c' : 'p') + (e.clientY - r.top < r.height / 2 ? 'v' : 'c');
  hc.classList.add('hovering');
  hc.querySelectorAll<HTMLElement>('.note').forEach((n) => n.classList.toggle('on', n.dataset.q === q));
});

// 时间线每列的点宽随屏幕宽度变
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderTimeline, 150);
});

async function init() {
  try {
    const r = (await (await fetch(`/api/board?v=${BOARD_VERSION}`)).json()) as BoardResponse;
    if (!r.ok) throw new Error(r.error);
    data = r.data;
    render(r.data);
  } catch {
    meta.textContent = '数据读取失败，请稍后刷新重试。';
  }
}

void init();
