// 管理链接页：密钥取自 location.hash，放在 Authorization 头里发给 /api/submission；页面不往浏览器存任何东西。
// 第 1 版问卷没答的新题可以补（只能填空，不强制）：B5 随状态一起，E8 / E9 在「补充新题」里
import {
  ACCOUNT_SOURCE,
  ACCOUNT_STATUS,
  ACCOUNTS_IN_ENV,
  APPEAL,
  BAN_AFTER,
  BAN_REASON,
  BAN_TRIGGER,
  CARD_KIND,
  CHAT_LANGUAGE,
  CLIENT,
  CN_CLIENT,
  DISTILL,
  EMAIL_TYPE,
  ENV_BAN_HISTORY,
  EXIT_TYPE,
  JAILBREAK,
  LEGACY_BAN_TRIGGER,
  LOGIN_METHOD,
  NODE_SWITCH,
  OS,
  PAYMENT_METHOD,
  PHONE_VERIFY,
  PLAN,
  PROXY_MODE,
  REFUND,
  REVERSE_PROXY,
  SENSITIVE_USE,
  SHARING,
  SUPPLEMENT_FIELDS,
  SYSTEM_LANGUAGE,
  TIMEZONE_SETTING,
  USAGE_CAP,
  type AccountStatus,
  type Appeal,
  type BanAfter,
  type BanReason,
  type BanTrigger,
  type CardInfo,
  type DeleteResponse,
  type Distill,
  type ManageResponse,
  type ManagedSubmission,
  type Payment,
  type Plan,
  type Refund,
  type SensitiveUse,
  type StatusUpdate,
  type SupplementRequest,
  type SurveyVersion,
} from '@claude-analysis/shared';
import { countryName } from '../lib/countries';
import { addSaved, removeSaved } from '../lib/saved';

const key = location.hash.slice(1);
const form = document.querySelector<HTMLFormElement>('#status-form')!;
const msg = document.querySelector<HTMLElement>('#msg')!;
const body = document.querySelector<HTMLElement>('#body')!;
const saveBtn = document.querySelector<HTMLButtonElement>('#save')!;

const q = (id: string) => form.querySelector<HTMLElement>(`[data-q="${id}"]`)!;
const shown = (el: HTMLElement) => !el.closest('[hidden]');
const one = <T extends string>(name: string) =>
  (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '') as T;
const many = <T extends string>(name: string) =>
  [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value as T);
const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;

let plan: Plan = 'free';
let registeredAt: string | null = null;
let version: SurveyVersion = 2;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  const node = document.querySelector<HTMLElement>('#toast')!;
  node.textContent = text;
  node.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.dataset.show = 'false'), 1600);
}

function showMessage(text: string) {
  msg.textContent = text;
  msg.hidden = false;
  body.hidden = true;
}

async function api<T>(method: 'GET' | 'PATCH' | 'DELETE', payload?: unknown): Promise<T | null> {
  try {
    const res = await fetch('/api/submission', {
      method,
      headers: { authorization: `Bearer ${key}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------- 显示条件（与问卷页一致） ----------

function update() {
  const status = one('status');
  const banned = status !== '' && status !== 'active';
  form.querySelector<HTMLElement>('[data-section="ban"]')!.hidden = !banned;
  q('appeal').hidden = status !== 'banned';
  q('refund').hidden = !(banned && plan !== 'free');
}

// ---------- 渲染 ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function paymentText(p: Payment): string {
  const card = (c: CardInfo) =>
    [CARD_KIND[c.kind], c.bin && `卡号前 6 位 ${c.bin}`, c.region && `发卡地区 ${countryName(c.region)}`].filter(Boolean).join(' · ');
  if (p.method === 'card') return `${PAYMENT_METHOD.card} · ${card(p.card)}`;
  if (p.method === 'app_store') return `${PAYMENT_METHOD.app_store} · Apple ID ${countryName(p.region)}区`;
  if (p.method === 'google_play') {
    return `${PAYMENT_METHOD.google_play} · ${p.via.kind === 'other' ? ['其他', p.via.note].filter(Boolean).join('：') : card(p.via)}`;
  }
  return PAYMENT_METHOD.reseller;
}

/** 入库的全部答案，按问卷顺序；没答的题不列 */
function answerRows({ answers: a, env: e }: ManagedSubmission): Array<[string, string]> {
  const manual = e.source === 'manual' ? e.answers : null;
  const rows: Array<[string, string | null | undefined]> = [
    ['账号状态', ACCOUNT_STATUS[a.status]],
    ['注册时间', a.registeredAt ?? '不清楚'],
    ['封禁日期', a.bannedAt],
    ['使用多久后被封禁', a.banAfter && BAN_AFTER[a.banAfter]],
    ['被封前后发生了什么', a.banTriggers?.map((t) => ({ ...BAN_TRIGGER, ...LEGACY_BAN_TRIGGER })[t]).join('、')],
    ['申诉情况', a.appeal && APPEAL[a.appeal]],
    ['封禁通知里写的原因', a.banReason && BAN_REASON[a.banReason]],
    ['账号来源', ACCOUNT_SOURCE[a.source]],
    ['登录方式', LOGIN_METHOD[a.login]],
    ['邮箱类型', a.emailType && `${EMAIL_TYPE[a.emailType]}${a.emailDomain ? `（@${a.emailDomain}）` : ''}`],
    ['注册时手机号怎么验证的', PHONE_VERIFY[a.phone]],
    ['订阅', PLAN[a.plan]],
    ['付款方式', a.payment && paymentText(a.payment)],
    ['被封后退款情况', a.refund && REFUND[a.refund]],
    ['同一网络或设备下的 Claude 账号', ACCOUNTS_IN_ENV[a.accountsInEnv]],
    ['同一设备或网络下有别的账号被封过', ENV_BAN_HISTORY[a.envBanHistory]],
    ['填写时的设备和网络与这个账号平时用的', e.same ? '一致' : '不一致'],
    ['网络环境怎么填的', e.source === 'detect' ? '检测站带入（只有检测结论，不含 IP）' : '手动填写'],
    ['代理情况', EXIT_TYPE[e.exitType]],
    ['出口国家或地区', manual ? (manual.exitRegion ? countryName(manual.exitRegion) : '不清楚') : undefined],
    ['代理模式', manual?.proxyMode && PROXY_MODE[manual.proxyMode]],
    ['系统时区', manual && TIMEZONE_SETTING[manual.timezone]],
    ['系统和浏览器语言', manual && SYSTEM_LANGUAGE[manual.language]],
    ['节点会不会自动切换', manual && NODE_SWITCH[manual.nodeSwitch]],
    ['国产手机或国产浏览器', manual && CN_CLIENT[manual.cnClient]],
    ['用哪些客户端', a.clients.map((c) => CLIENT[c]).join('、')],
    ['设备系统', a.os.map((o) => OS[o]).join('、')],
    ['用量上限', USAGE_CAP[a.usageCap]],
    ['对话主要用什么语言', CHAT_LANGUAGE[a.chatLanguage]],
    ['谁在用这个账号', SHARING[a.sharing]],
    ['CPA 或其他逆向 / 反代软件', a.reverseProxy.map((r) => REVERSE_PROXY[r]).join('、')],
    ['破限或 NSFW', JAILBREAK[a.jailbreak]],
    ['蒸馏', a.distill && DISTILL[a.distill]],
    ['用途', a.sensitiveUse?.map((u) => SENSITIVE_USE[u]).join('、')],
    ['补充', a.note],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

/** 按入库内容回填状态表单 */
function prefill({ answers: a }: ManagedSubmission) {
  const check = (name: string, values: string[]) =>
    form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((i) => (i.checked = values.includes(i.value)));
  check('status', [a.status]);
  const [y = '', m = '', d = ''] = a.bannedAt?.split('-') ?? [];
  select('bannedAt.year').value = y;
  select('bannedAt.month').value = m;
  select('bannedAt.day').value = d;
  check('banAfter', a.banAfter ? [a.banAfter] : []);
  check('banTriggers', a.banTriggers ?? []);
  check('appeal', a.appeal ? [a.appeal] : []);
  check('banReason', a.banReason ? [a.banReason] : []);
  check('refund', a.refund ? [a.refund] : []);
}

/** 题目标「选填」：第 1 版问卷的新题 */
function markOptional(fs: HTMLElement, optional: boolean) {
  const legend = fs.querySelector('legend')!;
  let meta = legend.querySelector<HTMLElement>('[data-added]');
  if (optional && !meta) {
    meta = el('span', 'q__meta', '选填');
    meta.dataset.added = '';
    legend.insertBefore(meta, legend.querySelector('.q__hint'));
  }
  if (!optional) meta?.remove();
}

const supplement = document.querySelector<HTMLElement>('#supplement')!;
const supForm = document.querySelector<HTMLFormElement>('#supplement-form')!;
const supQ = (id: string) => supForm.querySelector<HTMLElement>(`[data-q="${id}"]`)!;

/** 补充新题：只列还没答的；都答了就不显示 */
function renderSupplement({ answers: a }: ManagedSubmission) {
  const missing = SUPPLEMENT_FIELDS.filter((f) => a[f] === undefined);
  for (const f of SUPPLEMENT_FIELDS) supQ(f).hidden = !missing.includes(f);
  supplement.hidden = !missing.length;
  document.querySelector<HTMLElement>('#supplement-b5')!.hidden = !(a.status !== 'active' && !a.banReason);
}

function render(sub: ManagedSubmission) {
  plan = sub.answers.plan;
  registeredAt = sub.answers.registeredAt;
  version = sub.v;
  markOptional(q('banReason'), version === 1);
  renderSupplement(sub);
  document.querySelector('#timeline')!.textContent = `状态记录：${sub.events
    .map((e) => `${e.onDate} ${ACCOUNT_STATUS[e.status]}`)
    .join(' → ')}`;
  prefill(sub);
  update();
  const rows = answerRows(sub).map(([label, value]) => {
    const row = el('div', 'review__row');
    row.append(el('dt', '', label), el('dd', '', value));
    return row;
  });
  document.querySelector('#answers')!.replaceChildren(...rows);
  msg.hidden = true;
  body.hidden = false;
  saveBtn.disabled = false;
}

// ---------- 错误提示 ----------

function setError(id: string, text: string) {
  const fs = q(id);
  const p = fs.querySelector<HTMLElement>(':scope > .q__error')!;
  p.textContent = text;
  p.hidden = false;
}

function clearErrors() {
  form.querySelectorAll<HTMLElement>('.q__error').forEach((p) => (p.hidden = true));
}

// ---------- 保存 / 删除 ----------

form.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  // 多选互斥：选「没有明显事件」清掉其他项，选其他项清掉它
  if (t.type === 'checkbox' && t.checked) {
    const exclusive = 'exclusive' in t.dataset;
    form.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${t.name}"]`).forEach((i) => {
      if (i !== t && (exclusive || 'exclusive' in i.dataset)) i.checked = false;
    });
  }
  t.closest<HTMLElement>('[data-q]')?.querySelector<HTMLElement>(':scope > .q__error')?.setAttribute('hidden', '');
  update();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  const errors: Array<[string, string]> = [];
  const pick = <T extends string>(id: string): T | undefined => {
    if (!shown(q(id))) return undefined;
    const v = one<T>(id);
    if (!v) errors.push([id, '请选择一项']);
    return v || undefined;
  };
  const status = pick<AccountStatus>('status');
  let bannedAt: string | undefined;
  if (shown(q('bannedAt'))) {
    const [y, m, d] = ['year', 'month', 'day'].map((p) => select(`bannedAt.${p}`).value);
    if (!y || !m) errors.push(['bannedAt', '请选择年和月']);
    else bannedAt = d ? `${y}-${m}-${d}` : `${y}-${m}`;
  }
  const banTriggers = shown(q('banTriggers')) ? many<BanTrigger>('banTriggers') : undefined;
  // 第 1 版问卷没问过 B5，补不补都行
  const banReason = shown(q('banReason')) ? one<BanReason>('banReason') || undefined : undefined;
  if (shown(q('banReason')) && !banReason && version !== 1) errors.push(['banReason', '请选择一项']);
  if (banTriggers && !banTriggers.length) errors.push(['banTriggers', '至少选一项']);
  const payload: StatusUpdate = {
    status: status!,
    bannedAt,
    banAfter: pick<BanAfter>('banAfter'),
    banTriggers,
    appeal: pick<Appeal>('appeal'),
    banReason,
    refund: pick<Refund>('refund'),
  };
  if (errors.length) {
    errors.forEach(([id, text]) => setError(id, text));
    return toast(`还有 ${errors.length} 题没填好`);
  }

  saveBtn.disabled = true;
  const r = await api<ManageResponse>('PATCH', payload);
  saveBtn.disabled = false;
  if (!r) return toast('网络出错，请稍后再试');
  if (r.ok) {
    render(r.submission);
    return toast('已保存');
  }
  if (r.error === 'not_found') return showMessage('没有找到这份问卷：可能已经删除。');
  if (r.field === 'bannedAt') {
    return setError('bannedAt', `日期不对：不能晚于今天${registeredAt ? `，也不能早于注册时间 ${registeredAt}` : ''}，日期要真实存在`);
  }
  if (r.field && form.querySelector(`[data-q="${r.field}"]`)) return setError(r.field, '这一题的答案没通过校验，请检查');
  toast('保存失败，请稍后再试');
});

// 补充新题：答了哪题就补哪题，一题都没答不提交
supForm.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.type === 'checkbox' && t.checked) {
    const exclusive = 'exclusive' in t.dataset;
    supForm.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${t.name}"]`).forEach((i) => {
      if (i !== t && (exclusive || 'exclusive' in i.dataset)) i.checked = false;
    });
  }
});

supForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const checkedOf = (name: string) => [...supForm.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value);
  const distill = shown(supQ('distill')) ? (checkedOf('distill')[0] as Distill | undefined) : undefined;
  const uses = shown(supQ('sensitiveUse')) ? (checkedOf('sensitiveUse') as SensitiveUse[]) : [];
  const payload: SupplementRequest = { supplement: { distill, sensitiveUse: uses.length ? uses : undefined } };
  if (!distill && !uses.length) return toast('还没选任何答案');
  const btn = document.querySelector<HTMLButtonElement>('#supplement-save')!;
  btn.disabled = true;
  const r = await api<ManageResponse>('PATCH', payload);
  btn.disabled = false;
  if (!r) return toast('网络出错，请稍后再试');
  if (r.ok) {
    render(r.submission);
    return toast('已补充，谢谢');
  }
  if (r.error === 'not_found') return showMessage('没有找到这份问卷：可能已经删除。');
  toast('保存失败，请稍后再试');
});

document.querySelector('#delete')!.addEventListener('click', async () => {
  if (!confirm('确定删除这份问卷？删除后无法恢复。')) return;
  const r = await api<DeleteResponse>('DELETE');
  if (!r?.ok) return toast('删除失败，请稍后再试');
  removeSaved(key);
  // 去掉地址栏里的密钥，链接已经失效
  history.replaceState(null, '', location.pathname);
  showMessage('已删除。这份问卷和它的状态记录已经从数据库删掉。');
});

// ---------- 初始化 ----------

/** 打开过管理链接的浏览器默认记住这份问卷（只存密钥），可以移除 */
function rememberHere() {
  const line = document.querySelector<HTMLElement>('#saved-line')!;
  line.hidden = !addSaved(key);
  document.querySelector('#forget')!.addEventListener('click', () => {
    removeSaved(key);
    line.textContent = '已从这个浏览器移除；问卷本身还在，凭管理链接仍能打开。';
  });
}

async function init() {
  if (!/^[A-Za-z0-9_-]{22}$/.test(key)) return showMessage('链接不完整：请使用提交问卷后拿到的完整管理链接。');
  const r = await api<ManageResponse>('GET');
  if (!r) showMessage('网络出错，请刷新页面重试。');
  else if (!r.ok) {
    removeSaved(key);
    showMessage('没有找到这份问卷：可能已经删除，或者链接不完整。');
  } else {
    render(r.submission);
    rememberHere();
    // 从问卷页「有新题可以补充」点进来：跳到要补的地方
    if (new URLSearchParams(location.search).has('add')) {
      (supplement.hidden ? form : supplement).scrollIntoView({ block: 'start' });
    }
  }
}

// 在这个页面上把完整链接粘进地址栏只会改 #，浏览器不重新加载，要手动重来一遍
window.addEventListener('hashchange', () => location.reload());

void init();
