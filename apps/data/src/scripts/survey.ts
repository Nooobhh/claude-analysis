// 问卷页：分步导航、显示条件、多选互斥、按步校验，生成 SurveySubmission。提交接口未上线，提交只在本地预览
import {
  SURVEY_VERSION,
  TEXT_LIMITS,
  type AccountsInEnv,
  type AccountSource,
  type AccountStatus,
  type Appeal,
  type BanAfter,
  type BanTrigger,
  type CardInfo,
  type CardKind,
  type ChatLanguage,
  type Client,
  type EmailType,
  type EnvBanHistory,
  type ExitType,
  type Jailbreak,
  type LoginMethod,
  type ManualEnv,
  type Os,
  type Payment,
  type PaymentMethod,
  type PhoneVerify,
  type Plan,
  type ProxyMode,
  type Refund,
  type ReverseProxy,
  type Sharing,
  type SurveyAnswers,
  type SurveyEnv,
  type SurveySubmission,
  type SystemLanguage,
  type TimezoneSetting,
  type UsageCap,
} from '@claude-analysis/shared';

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const form = document.querySelector<HTMLFormElement>('#survey')!;
const done = document.querySelector<HTMLElement>('#done')!;
const steps = [...form.querySelectorAll<HTMLElement>('[data-step]')];
const navItems = [...form.querySelectorAll<HTMLButtonElement>('.steps [data-goto]')];
const prevBtn = document.querySelector<HTMLButtonElement>('#prev')!;
const nextBtn = document.querySelector<HTMLButtonElement>('#next')!;
const LAST = steps.length - 1;

const q = (id: string) => form.querySelector<HTMLElement>(`[data-q="${id}"]`)!;
const sub = (id: string) => form.querySelector<HTMLElement>(`[data-sub="${id}"]`)!;
/** 按条件隐藏的题不校验、不提交；分步切换不用 hidden，不影响这里 */
const shown = (el: HTMLElement) => !el.closest('[hidden]');

const one = <T extends string>(name: string) =>
  (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '') as T;
const many = <T extends string>(name: string) =>
  [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value as T);
const control = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const text = (name: string) => control(name).value.trim();
const checked = (name: string) => (control(name) as HTMLInputElement).checked;

// ---------- 显示条件（与 docs/specs/survey.md 各题条件一致） ----------

function update() {
  const status = one('status');
  const banned = status !== '' && status !== 'active';
  const plan = one('plan');
  const paid = plan !== '' && plan !== 'free';
  const payment = one('payment');
  const gpVia = one('gpVia');
  const envSame = one('envSame');
  const envSource = one('envSource');

  form.querySelector<HTMLElement>('[data-section="ban"]')!.hidden = !banned;
  q('appeal').hidden = status !== 'banned';
  q('emailType').hidden = one('login') !== 'email';
  sub('emailDomain').hidden = one('emailType') !== 'other';
  q('payment').hidden = !paid;
  for (const m of ['card', 'app_store', 'google_play']) sub(m).hidden = payment !== m;
  const gpCard = gpVia === 'physical' || gpVia === 'virtual';
  q('gpBin').hidden = !gpCard;
  q('gpRegion').hidden = !gpCard;
  q('gpNote').hidden = gpVia !== 'other';
  q('refund').hidden = !(paid && banned);
  q('envSource').hidden = envSame !== 'same';
  sub('detect').hidden = !(envSame === 'same' && envSource === 'detect');
  sub('manual').hidden = !(envSame === 'different' || (envSame === 'same' && envSource === 'manual'));
  q('proxyMode').hidden = one('exitType') === 'abroad';
  document.querySelector<HTMLElement>('#snap')!.hidden = !text('resultCode');

  const regUnknown = checked('registeredAt.unknown');
  for (const n of ['registeredAt.year', 'registeredAt.month']) control(n).disabled = regUnknown;
}

// ---------- 错误提示 ----------

function setError(id: string, msg: string) {
  const el = q(id);
  const p = el.querySelector<HTMLElement>(':scope > .q__error')!;
  p.textContent = msg;
  p.hidden = false;
  el.dataset.invalid = '';
}

function clearError(target: EventTarget | null) {
  const el = (target as Element | null)?.closest<HTMLElement>('[data-q]');
  if (!el) return;
  el.querySelector<HTMLElement>(':scope > .q__error')!.hidden = true;
  delete el.dataset.invalid;
}

// ---------- 读取 + 校验 ----------

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** YYYY-MM 或 YYYY-MM-DD；年月没选全返回 '' */
function readDate(id: string, withDay: boolean): string {
  const y = text(`${id}.year`);
  const m = text(`${id}.month`);
  if (!y || !m) return '';
  const d = withDay ? text(`${id}.day`) : '';
  return d ? `${y}-${m}-${d}` : `${y}-${m}`;
}

const normalizeDomain = (v: string) => v.toLowerCase().replace(/^@/, '');

function dayExists(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
}

function build(): { data: SurveySubmission | null; errors: Map<string, string> } {
  const errors = new Map<string, string>();
  const isShown = (id: string) => shown(q(id));
  const pick = <T extends string>(id: string): T => {
    const v = one<T>(id);
    if (!v && isShown(id)) errors.set(id, '请选择一项');
    return v;
  };
  const pickMany = <T extends string>(id: string): T[] => {
    const v = many<T>(id);
    if (!v.length && isShown(id)) errors.set(id, '至少选一项');
    return v;
  };
  const cardInfo = (kind: CardKind, binName: string, regionName: string): CardInfo => {
    const bin = text(binName);
    if (bin && !/^\d{6}$/.test(bin)) errors.set(binName, '请填 6 位数字');
    return { kind, bin: bin || undefined, region: text(regionName) || undefined };
  };

  // A
  const status = pick<AccountStatus>('status');
  let registeredAt: string | null = null;
  if (!checked('registeredAt.unknown')) {
    registeredAt = readDate('registeredAt', false);
    if (!registeredAt) errors.set('registeredAt', '请选择年和月，或勾选「不清楚」');
    else if (registeredAt > TODAY.slice(0, 7)) errors.set('registeredAt', '注册时间不能晚于今天');
  }

  // B
  let bannedAt: string | undefined;
  if (isShown('bannedAt')) {
    bannedAt = readDate('bannedAt', true);
    if (!bannedAt) errors.set('bannedAt', '请选择年和月');
    else if (bannedAt.length === 10 && !dayExists(bannedAt)) errors.set('bannedAt', '这个日期不存在');
    else if (bannedAt > TODAY) errors.set('bannedAt', '封禁日期不能晚于今天');
    else if (registeredAt && bannedAt.slice(0, 7) < registeredAt) errors.set('bannedAt', '封禁日期早于注册时间');
  }

  // C
  let emailDomain: string | undefined;
  if (shown(sub('emailDomain'))) {
    emailDomain = normalizeDomain(text('emailDomain')) || undefined;
    if (emailDomain && !DOMAIN.test(emailDomain)) errors.set('emailDomain', '请填域名，比如 example.com');
  }

  let payment: Payment | undefined;
  if (isShown('payment')) {
    const method = pick<PaymentMethod>('payment');
    if (method === 'card') payment = { method, card: cardInfo(pick<CardKind>('cardKind'), 'cardBin', 'cardRegion') };
    if (method === 'app_store') {
      const region = text('appStoreRegion');
      if (!region) errors.set('appStoreRegion', '请选择 Apple ID 所在区');
      payment = { method, region };
    }
    if (method === 'google_play') {
      const via = pick<CardKind | 'other'>('gpVia');
      payment = {
        method,
        via: via === 'other' ? { kind: 'other', note: text('gpNote') || undefined } : cardInfo(via, 'gpBin', 'gpRegion'),
      };
    }
    if (method === 'reseller') payment = { method };
  }

  // D
  let env: SurveyEnv | undefined;
  const same = pick<'same' | 'different'>('envSame');
  const source = pick<'detect' | 'manual'>('envSource');
  if (same === 'same' && source === 'detect') {
    const token = text('resultCode');
    if (!token) errors.set('resultCode', '请粘贴检测站的结果码');
    env = { same: true, source: 'detect', token };
  } else if (shown(sub('manual'))) {
    const exitRegion = text('exitRegion');
    if (!exitRegion) errors.set('exitRegion', '请选择，或选「不清楚」');
    const manual: ManualEnv = {
      exitRegion: exitRegion === 'unknown' ? null : exitRegion,
      exitType: pick<ExitType>('exitType'),
      proxyMode: isShown('proxyMode') ? pick<ProxyMode>('proxyMode') : undefined,
      timezone: pick<TimezoneSetting>('timezone'),
      language: pick<SystemLanguage>('language'),
    };
    env = { same: same === 'same', source: 'manual', answers: manual };
  }

  const answers: SurveyAnswers = {
    status,
    registeredAt,
    bannedAt,
    banAfter: isShown('banAfter') ? pick<BanAfter>('banAfter') : undefined,
    banTriggers: isShown('banTriggers') ? pickMany<BanTrigger>('banTriggers') : undefined,
    appeal: isShown('appeal') ? pick<Appeal>('appeal') : undefined,
    source: pick<AccountSource>('source'),
    login: pick<LoginMethod>('login'),
    emailType: isShown('emailType') ? pick<EmailType>('emailType') : undefined,
    emailDomain,
    phone: pick<PhoneVerify>('phone'),
    plan: pick<Plan>('plan'),
    payment,
    refund: isShown('refund') ? pick<Refund>('refund') : undefined,
    accountsInEnv: pick<AccountsInEnv>('accountsInEnv'),
    envBanHistory: pick<EnvBanHistory>('envBanHistory'),
    clients: pickMany<Client>('clients'),
    os: pickMany<Os>('os'),
    usageCap: pick<UsageCap>('usageCap'),
    chatLanguage: pick<ChatLanguage>('chatLanguage'),
    sharing: pick<Sharing>('sharing'),
    reverseProxy: pickMany<ReverseProxy>('reverseProxy'),
    jailbreak: pick<Jailbreak>('jailbreak'),
    note: text('note') || undefined,
  };

  if (errors.size || !env) return { data: null, errors };
  return { data: { v: SURVEY_VERSION, answers, env }, errors };
}

// ---------- 确认页汇总 ----------

/** 一道题的答案文字；没答返回 '' */
function answerText(fs: HTMLElement): string {
  const id = fs.dataset.q!;
  if (id === 'registeredAt') return checked('registeredAt.unknown') ? '不清楚' : readDate('registeredAt', false);
  if (id === 'bannedAt') return readDate('bannedAt', true);
  if (id === 'resultCode') return text('resultCode') ? '已粘贴，带入检测站结果' : '';
  const own = [...fs.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')].filter(
    (el) => el.closest('[data-q]') === fs,
  );
  return own
    .flatMap((el) => {
      if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
        return el.checked ? [el.closest('.opt')!.textContent!.trim()] : [];
      }
      if (el instanceof HTMLSelectElement) return el.value ? [el.selectedOptions[0].textContent!.trim()] : [];
      const v = el.value.trim();
      return v ? [el.name === 'emailDomain' ? `@${normalizeDomain(v)}` : v] : [];
    })
    .join('、');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, textContent = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = textContent;
  return node;
}

function renderReview() {
  const groups = steps.slice(0, LAST).map((step, i) => {
    const group = el('section', 'review__group');
    const head = el('div', 'review__head');
    const title = el('h3', 'review__title');
    title.append(el('span', 'card__num', navItems[i].querySelector('.steps__num')!.textContent!), navItems[i].querySelector('.steps__name')!.textContent!);
    const edit = el('button', 'review__edit', '修改');
    edit.type = 'button';
    edit.dataset.goto = String(i);
    head.append(title, edit);

    const list = el('dl', 'review__list');
    for (const fs of step.querySelectorAll<HTMLElement>('[data-q]')) {
      if (!shown(fs)) continue;
      const answer = answerText(fs);
      const row = el('div', 'review__row');
      row.append(el('dt', '', fs.dataset.label!), el('dd', answer ? '' : 'review__empty', answer || ('optional' in fs.dataset ? '未填' : '—')));
      list.append(row);
    }
    group.append(head, list);
    return group;
  });
  document.querySelector('#review')!.replaceChildren(...groups);
}

// ---------- 分步 ----------

let current = 0;
let furthest = 0;

function go(i: number, push = true) {
  current = i;
  furthest = Math.max(furthest, i);
  steps.forEach((s, k) => s.toggleAttribute('data-active', k === i));
  navItems.forEach((n, k) => {
    n.dataset.state = k < i ? 'done' : k === i ? 'current' : 'todo';
    n.disabled = k > furthest;
    if (k === i) n.setAttribute('aria-current', 'step');
    else n.removeAttribute('aria-current');
  });
  prevBtn.hidden = i === 0;
  nextBtn.textContent = i === LAST ? '提交问卷' : '下一步';
  if (i === LAST) renderReview();
  form.hidden = false;
  done.hidden = true;
  if (push) history.pushState({ step: i }, '');
  // 只在已经滚过表单顶部时回滚，短步骤不跳动
  const top = form.getBoundingClientRect().top + window.scrollY - 72;
  if (window.scrollY > top) window.scrollTo({ top });
}

function showErrors(list: Array<[string, string]>) {
  for (const [id, msg] of list) setError(id, msg);
  const first = steps[current].querySelector<HTMLElement>('[data-invalid]');
  first?.scrollIntoView({ block: 'center' });
  first?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea')?.focus({ preventScroll: true });
  toast(`还有 ${list.length} 题没填好`);
}

const stepOf = (id: string) => Number(q(id).closest<HTMLElement>('[data-step]')!.dataset.step);

// ---------- 提交后（预览） ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) {
  const node = document.querySelector<HTMLElement>('#toast')!;
  node.textContent = msg;
  node.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.dataset.show = 'false'), 1600);
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let dirty = false;

function showDone(data: SurveySubmission) {
  document.querySelector<HTMLInputElement>('#manage-link')!.value = `${location.origin}/m/${randomKey()}`;
  document.querySelector('#json')!.textContent = JSON.stringify(data, null, 2);
  form.hidden = true;
  done.hidden = false;
  dirty = false;
  window.scrollTo({ top: 0 });
}

// ---------- 事件 ----------

form.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  // 多选互斥：选「没有 / 不清楚」清掉其他项，选其他项清掉它们
  if (t.type === 'checkbox' && t.checked) {
    const exclusive = 'exclusive' in t.dataset;
    form.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${t.name}"]`).forEach((i) => {
      if (i !== t && (exclusive || 'exclusive' in i.dataset)) i.checked = false;
    });
  }
  dirty = true;
  clearError(t);
  update();
});

form.addEventListener('input', (e) => {
  dirty = true;
  clearError(e.target);
  if ((e.target as HTMLElement).getAttribute('name') === 'resultCode') update();
});

const note = control('note') as HTMLTextAreaElement;
note.addEventListener('input', () => {
  document.querySelector('#note-count')!.textContent = `${note.value.length} / ${TEXT_LIMITS.note}`;
});

// 「下一步」和「提交问卷」是同一个 submit 按钮，回车也走这里
form.addEventListener('submit', (e) => {
  e.preventDefault();
  form.querySelectorAll<HTMLElement>('[data-invalid]').forEach((node) => clearError(node));
  const { data, errors } = build();
  if (current < LAST) {
    const mine = [...errors].filter(([id]) => stepOf(id) === current);
    if (mine.length) return showErrors(mine);
    return go(current + 1);
  }
  if (!data) {
    // 跳回了前面某步改过答案，可能留下没填的题
    const first = Math.min(...[...errors.keys()].map(stepOf));
    go(first);
    return showErrors([...errors].filter(([id]) => stepOf(id) === first));
  }
  showDone(data);
});

prevBtn.addEventListener('click', () => go(current - 1));

document.addEventListener('click', (e) => {
  const target = (e.target as Element).closest<HTMLElement>('[data-goto]');
  if (target && !(target as HTMLButtonElement).disabled) go(Number(target.dataset.goto));
});

window.addEventListener('popstate', (e) => go((e.state as { step?: number } | null)?.step ?? 0, false));

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

document.querySelector('#copy-link')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector<HTMLInputElement>('#manage-link')!.value);
    toast('已复制管理链接');
  } catch {
    toast('复制失败，请手动选中复制');
  }
});

history.replaceState({ step: 0 }, '');
update();
go(0, false);
nextBtn.disabled = false;
