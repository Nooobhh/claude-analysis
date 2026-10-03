// 提交内容的服务端校验：规则与问卷页的显示条件、校验一致（docs/specs/survey.md「题目」「校验」）。
// 只把认识的字段拷进新对象返回，多余字段丢掉；不显示的题即使传了也不会入库
import { BROWSER_FAMILIES, OS_FAMILIES, type LocalSnapshot, type WebrtcLeak } from './snapshot';
import {
  ACCOUNT_SOURCE,
  ACCOUNT_STATUS,
  ACCOUNTS_IN_ENV,
  APPEAL,
  BAN_AFTER,
  BAN_TRIGGER,
  CARD_KIND,
  CHAT_LANGUAGE,
  CLIENT,
  CN_CLIENT,
  EMAIL_TYPE,
  ENV_BAN_HISTORY,
  EXIT_TYPE,
  JAILBREAK,
  LOGIN_METHOD,
  NODE_SWITCH,
  OS,
  PAYMENT_METHOD,
  PHONE_VERIFY,
  PLAN,
  PROXY_MODE,
  REFUND,
  REVERSE_PROXY,
  SHARING,
  SURVEY_VERSION,
  SYSTEM_LANGUAGE,
  TEXT_LIMITS,
  TIMEZONE_SETTING,
  USAGE_CAP,
  type CardInfo,
  type ExitType,
  type ManualEnv,
  type Payment,
  type SurveyAnswers,
  type SurveyEnv,
  type SurveySubmission,
} from './survey';
import { CHECK_IDS, STATUS_LABEL, type CheckId, type Status } from './index';

export type Validated<T> = { ok: true; value: T } | { ok: false; field: string };

class Invalid extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, field: string): Obj {
  if (!isObj(v)) throw new Invalid(field);
  return v;
}

/** 单选：值必须是选项表里的 key */
function one<T extends Record<string, string>>(opts: T, v: unknown, field: string): keyof T & string {
  if (typeof v !== 'string' || !Object.hasOwn(opts, v)) throw new Invalid(field);
  return v;
}

/** 多选：至少一项、不重复；互斥项只能单独出现 */
function many<T extends Record<string, string>>(opts: T, v: unknown, field: string, exclusive: string[] = []): Array<keyof T & string> {
  if (!Array.isArray(v) || !v.length) throw new Invalid(field);
  const list = v.map((x) => one(opts, x, field));
  if (new Set(list).size !== list.length) throw new Invalid(field);
  if (list.length > 1 && list.some((x) => exclusive.includes(x))) throw new Invalid(field);
  return list;
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw new Invalid(field);
  return v;
}

/** 选填文本：缺省或空串返回 undefined */
function optText(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined) return undefined;
  return str(v, field, max).trim() || undefined;
}

const COUNTRY = /^[A-Z]{2}$/;
function country(v: unknown, field: string): string {
  if (typeof v !== 'string' || !COUNTRY.test(v)) throw new Invalid(field);
  return v;
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** YYYY-MM，或 withDay 时允许 YYYY-MM-DD；不能晚于 today（YYYY-MM-DD） */
function date(v: unknown, field: string, today: string, withDay: boolean): string {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v) : null;
  if (!m || (m[3] && !withDay)) throw new Invalid(field);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2023 || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) throw new Invalid(field);
  if (v as string > today.slice(0, (v as string).length)) throw new Invalid(field);
  return v as string;
}

function card(v: unknown, field: string): CardInfo {
  const c = obj(v, field);
  const bin = optText(c.bin, `${field}.bin`, 6);
  if (bin && !/^\d{6}$/.test(bin)) throw new Invalid(`${field}.bin`);
  return {
    kind: one(CARD_KIND, c.kind, `${field}.kind`),
    bin,
    region: c.region === undefined ? undefined : country(c.region, `${field}.region`),
  };
}

function payment(v: unknown): Payment {
  const p = obj(v, 'payment');
  const method = one(PAYMENT_METHOD, p.method, 'payment.method');
  if (method === 'card') return { method, card: card(p.card, 'payment.card') };
  if (method === 'app_store') return { method, region: country(p.region, 'payment.region') };
  if (method === 'google_play') {
    const via = obj(p.via, 'payment.via');
    return via.kind === 'other'
      ? { method, via: { kind: 'other', note: optText(via.note, 'payment.via.note', TEXT_LIMITS.paymentNote) } }
      : { method, via: card(via, 'payment.via') };
  }
  return { method };
}

function answers(v: unknown, today: string): SurveyAnswers {
  const a = obj(v, 'answers');
  const status = one(ACCOUNT_STATUS, a.status, 'status');
  const registeredAt = a.registeredAt === null ? null : date(a.registeredAt, 'registeredAt', today, false);
  const login = one(LOGIN_METHOD, a.login, 'login');
  const plan = one(PLAN, a.plan, 'plan');
  const banned = status !== 'active';
  const paid = plan !== 'free';

  let bannedAt: string | undefined;
  if (banned) {
    bannedAt = date(a.bannedAt, 'bannedAt', today, true);
    if (registeredAt && bannedAt.slice(0, 7) < registeredAt) throw new Invalid('bannedAt');
  }
  const emailType = login === 'email' ? one(EMAIL_TYPE, a.emailType, 'emailType') : undefined;
  let emailDomain: string | undefined;
  if (emailType === 'other') {
    emailDomain = optText(a.emailDomain, 'emailDomain', TEXT_LIMITS.emailDomain)?.toLowerCase().replace(/^@/, '');
    if (emailDomain && !DOMAIN.test(emailDomain)) throw new Invalid('emailDomain');
  }

  return {
    status,
    registeredAt,
    bannedAt,
    banAfter: banned ? one(BAN_AFTER, a.banAfter, 'banAfter') : undefined,
    banTriggers: banned ? many(BAN_TRIGGER, a.banTriggers, 'banTriggers', ['none']) : undefined,
    appeal: status === 'banned' ? one(APPEAL, a.appeal, 'appeal') : undefined,
    source: one(ACCOUNT_SOURCE, a.source, 'source'),
    login,
    emailType,
    emailDomain,
    phone: one(PHONE_VERIFY, a.phone, 'phone'),
    plan,
    payment: paid ? payment(a.payment) : undefined,
    refund: paid && banned ? one(REFUND, a.refund, 'refund') : undefined,
    accountsInEnv: one(ACCOUNTS_IN_ENV, a.accountsInEnv, 'accountsInEnv'),
    envBanHistory: one(ENV_BAN_HISTORY, a.envBanHistory, 'envBanHistory'),
    clients: many(CLIENT, a.clients, 'clients'),
    os: many(OS, a.os, 'os'),
    usageCap: one(USAGE_CAP, a.usageCap, 'usageCap'),
    chatLanguage: one(CHAT_LANGUAGE, a.chatLanguage, 'chatLanguage'),
    sharing: one(SHARING, a.sharing, 'sharing'),
    reverseProxy: many(REVERSE_PROXY, a.reverseProxy, 'reverseProxy', ['none']),
    jailbreak: one(JAILBREAK, a.jailbreak, 'jailbreak'),
    note: optText(a.note, 'note', TEXT_LIMITS.note),
  };
}

function manualEnv(v: unknown, exitType: ExitType): ManualEnv {
  const m = obj(v, 'env.answers');
  return {
    exitRegion: m.exitRegion === null ? null : country(m.exitRegion, 'exitRegion'),
    proxyMode: exitType === 'abroad' ? undefined : one(PROXY_MODE, m.proxyMode, 'proxyMode'),
    timezone: one(TIMEZONE_SETTING, m.timezone, 'timezone'),
    language: one(SYSTEM_LANGUAGE, m.language, 'language'),
    nodeSwitch: one(NODE_SWITCH, m.nodeSwitch, 'nodeSwitch'),
    cnClient: one(CN_CLIENT, m.cnClient, 'cnClient'),
  };
}

function env(v: unknown): SurveyEnv {
  const e = obj(v, 'env');
  if (typeof e.same !== 'boolean') throw new Invalid('envSame');
  const exitType = one(EXIT_TYPE, e.exitType, 'exitType');
  if (e.source === 'detect') {
    // 环境不一致时只能手动填写
    if (!e.same) throw new Invalid('envSource');
    return { same: true, exitType, source: 'detect', token: str(e.token, 'resultCode', 4096) };
  }
  if (e.source !== 'manual') throw new Invalid('envSource');
  return { same: e.same, exitType, source: 'manual', answers: manualEnv(e.answers, exitType) };
}

function run<T>(fn: () => T): Validated<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, field: err.field };
    throw err;
  }
}

/** 校验一份提交；today 为服务器当天日期 YYYY-MM-DD。结果码只检查是字符串，验签另做 */
export const validateSubmission = (input: unknown, today: string): Validated<SurveySubmission> =>
  run(() => {
    const s = obj(input, 'submission');
    if (s.v !== SURVEY_VERSION) throw new Invalid('v');
    return { v: SURVEY_VERSION, answers: answers(s.answers, today), env: env(s.env) };
  });

/** 只校验答案部分：管理链接更新状态时，把新状态并进原答案后整份再校验一遍 */
export const validateAnswers = (input: unknown, today: string): Validated<SurveyAnswers> => run(() => answers(input, today));

const WEBRTC: WebrtcLeak[] = ['disabled', 'none', 'mainland', 'other'];

/** 结果码的 local 段不签名，入库前按类型逐项检查并限长 */
export const validateLocalSnapshot = (input: unknown): Validated<LocalSnapshot> =>
  run(() => {
    const l = obj(input, 'local');
    const fp = obj(l.fp, 'local.fp');
    const leak = obj(l.leak, 'local.leak');
    const status: Partial<Record<CheckId, Status>> = {};
    for (const [id, st] of Object.entries(obj(l.status, 'local.status'))) {
      if (!(CHECK_IDS as readonly string[]).includes(id)) throw new Invalid('local.status');
      status[id as CheckId] = one(STATUS_LABEL, st, 'local.status');
    }
    const nullableStr = (v: unknown, field: string, max: number) => (v === null ? null : str(v, field, max));
    const offsetMin = fp.offsetMin;
    if (typeof offsetMin !== 'number' || !Number.isInteger(offsetMin) || Math.abs(offsetMin) > 840) throw new Invalid('local.fp.offsetMin');
    const languages = fp.languages;
    if (!Array.isArray(languages) || languages.length > 3) throw new Invalid('local.fp.languages');
    const dns = leak.dnsCountries;
    if (dns !== null && (!Array.isArray(dns) || dns.length > 10)) throw new Invalid('local.leak.dnsCountries');
    const family = <T extends readonly string[]>(list: T, v: unknown, field: string): T[number] => {
      if (typeof v !== 'string' || !list.includes(v)) throw new Invalid(field);
      return v;
    };
    // Cloudflare trace 的国家码还可能是 XX（未知）、T1（Tor）
    const exitCountry = l.exitCountry === null ? null : str(l.exitCountry, 'local.exitCountry', 2);
    if (exitCountry !== null && !/^[A-Z][A-Z0-9]$/.test(exitCountry)) throw new Invalid('local.exitCountry');
    const commit = str(l.commit, 'local.commit', 40);
    if (!/^[0-9a-f]*$/.test(commit)) throw new Invalid('local.commit');
    return {
      version: str(l.version, 'local.version', 20),
      commit,
      status,
      exitCountry,
      fp: {
        timezone: str(fp.timezone, 'local.fp.timezone', 64),
        offsetMin,
        languages: languages.map((x) => str(x, 'local.fp.languages', 35)),
        locale: str(fp.locale, 'local.fp.locale', 35),
        cnFonts: fp.cnFonts === true,
        cnBrowser: nullableStr(fp.cnBrowser, 'local.fp.cnBrowser', 30),
        cnDevice: nullableStr(fp.cnDevice, 'local.fp.cnDevice', 30),
        os: family(OS_FAMILIES, fp.os, 'local.fp.os'),
        browser: family(BROWSER_FAMILIES, fp.browser, 'local.fp.browser'),
      },
      leak: {
        webrtc: family(WEBRTC, leak.webrtc, 'local.leak.webrtc'),
        dnsCountries: dns === null ? null : dns.map((x) => country(x, 'local.leak.dnsCountries')),
      },
    };
  });
