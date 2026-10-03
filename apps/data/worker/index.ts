// 问卷站 Worker：只处理 /api/*，页面由静态资源直接响应（见 wrangler.jsonc run_worker_first）
// 隐私：不读取请求 IP（不碰 cf-connecting-ip 等请求头，也不读 request.cf），不打日志；承诺见 src/pages/privacy.astro
import {
  STATUS_FIELDS,
  SUPPLEMENT_FIELDS,
  normalizeExitType,
  importVerifyKey,
  validateAnswers,
  validateLocalSnapshot,
  validateSubmission,
  verifyResultCode,
  type DeleteResponse,
  type DetectSnapshot,
  type ManageResponse,
  type ManagedSubmission,
  type StatsResponse,
  type SubmitResponse,
  type SurveyAnswers,
  type SurveyVersion,
} from '@claude-analysis/shared';
import type { BoardData, BoardResponse } from '../src/lib/board';
import { RESULT_CODE_PUBLIC_KEY } from '../src/lib/result-code';
import { buildBoard, type Sub } from './board';

/** 一份问卷的 JSON 远小于这个数，超过直接拒收 */
const MAX_BODY = 32 * 1024;

const reply = (body: SubmitResponse | ManageResponse | DeleteResponse | StatsResponse | BoardResponse | { error: string }, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const today = () => new Date().toISOString().slice(0, 10);

// 结果码验签公钥：每个 isolate 只导入一次
let verifyKey: Promise<CryptoKey> | null = null;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 管理链接密钥：128 位随机数，base64url（22 个字符） */
function randomKey(): string {
  let bin = '';
  for (const b of crypto.getRandomValues(new Uint8Array(16))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 读 JSON 请求体；超长或解析失败返回 undefined */
async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------- 提交 ----------

async function handleSubmit(req: Request, env: Env): Promise<Response> {
  const input = await readJson(req);
  if (input === undefined) return reply({ ok: false, error: 'bad_request' }, 400);

  const date = today();
  const checked = validateSubmission(input, date);
  if (!checked.ok) return reply({ ok: false, error: 'invalid', field: checked.field }, 400);
  const { v, answers, env: survey } = checked.value;

  // 检测站路径：验签 + 有效期，local 段不签名，入库前再逐项检查
  let snapshot: DetectSnapshot | null = null;
  let codeHash: string | null = null;
  if (survey.source === 'detect') {
    verifyKey ??= importVerifyKey(RESULT_CODE_PUBLIC_KEY);
    const r = await verifyResultCode(survey.token, await verifyKey);
    if (!r.ok) return reply({ ok: false, error: `code_${r.error}` as const }, 400);
    const local = validateLocalSnapshot(r.snapshot.local);
    if (!local.ok) return reply({ ok: false, error: 'code_format', field: local.field }, 400);
    snapshot = { signed: r.snapshot.signed, local: local.value };
    codeHash = await sha256(survey.token.split('.')[2]);
  }
  // 结果码原文不入库，内容已在 snapshot 里
  const envStored: ManagedSubmission['env'] =
    survey.source === 'detect' ? { same: survey.same, exitType: survey.exitType, source: survey.source } : survey;

  const key = randomKey();
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO submissions (id, key_hash, v, status, answers, env_source, env, snapshot, code_hash, created_on, updated_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
      ).bind(
        id,
        await sha256(key),
        v,
        answers.status,
        JSON.stringify(answers),
        survey.source,
        JSON.stringify(envStored),
        snapshot && JSON.stringify(snapshot),
        codeHash,
        date,
      ),
      env.DB.prepare('INSERT INTO status_events (submission_id, status, on_date) VALUES (?1, ?2, ?3)').bind(id, answers.status, date),
    ]);
  } catch (err) {
    if (/UNIQUE constraint failed: submissions\.code_hash/.test(String(err))) return reply({ ok: false, error: 'code_used' }, 409);
    return reply({ ok: false, error: 'server' }, 500);
  }
  return reply({ ok: true, key });
}

/** 读库里的网络环境：早期问卷的旧选项换成现在的（库里不改） */
function readEnv(text: string): ManagedSubmission['env'] {
  const e = JSON.parse(text) as ManagedSubmission['env'];
  return { ...e, exitType: normalizeExitType(e.exitType) };
}

// ---------- 已收集份数 ----------

// 每个 isolate 缓存 60 秒，少查 D1（Cache API 在 workers.dev 上不起作用）
const STATS_TTL = 60_000;
let stats: { total: number; at: number } | null = null;

async function handleStats(env: Env): Promise<Response> {
  if (!stats || Date.now() - stats.at > STATS_TTL) {
    try {
      const row = await env.DB.prepare('SELECT count(*) AS total FROM submissions').first<{ total: number }>();
      stats = { total: row?.total ?? 0, at: Date.now() };
    } catch {
      return reply({ ok: false, error: 'server' }, 500);
    }
  }
  return Response.json({ ok: true, total: stats.total } satisfies StatsResponse, {
    headers: { 'cache-control': 'public, max-age=60' },
  });
}

// ---------- 看板：只下发汇总 ----------

// 每个实例缓存 5 分钟；问卷不多，整表读出来在内存里算
const BOARD_TTL = 5 * 60_000;
let board: { data: BoardData; at: number } | null = null;

async function handleBoard(env: Env): Promise<Response> {
  if (!board || Date.now() - board.at > BOARD_TTL) {
    try {
      const { results } = await env.DB.prepare('SELECT answers, env, snapshot FROM submissions').all<{ answers: string; env: string; snapshot: string | null }>();
      const subs: Sub[] = results.map((r) => ({
        answers: JSON.parse(r.answers) as SurveyAnswers,
        env: readEnv(r.env),
        snapshot: r.snapshot ? (JSON.parse(r.snapshot) as DetectSnapshot) : null,
      }));
      board = { data: buildBoard(subs, today()), at: Date.now() };
    } catch {
      return reply({ ok: false, error: 'server' }, 500);
    }
  }
  return Response.json({ ok: true, data: board.data } satisfies BoardResponse, { headers: { 'cache-control': 'public, max-age=300' } });
}

// ---------- 管理链接：凭密钥查看、更新状态、删除 ----------

interface Row {
  id: string;
  v: SurveyVersion;
  answers: string;
  env: string;
  created_on: string;
  updated_on: string;
}

/** 密钥放在 Authorization 头里传，不进 URL；库里只有它的哈希 */
async function findByKey(req: Request, env: Env): Promise<Row | null> {
  const key = /^Bearer ([A-Za-z0-9_-]{22})$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!key) return null;
  return env.DB.prepare('SELECT id, v, answers, env, created_on, updated_on FROM submissions WHERE key_hash = ?1')
    .bind(await sha256(key))
    .first<Row>();
}

async function load(row: Row, env: Env): Promise<ManagedSubmission> {
  const { results } = await env.DB.prepare('SELECT status, on_date FROM status_events WHERE submission_id = ?1 ORDER BY rowid')
    .bind(row.id)
    .all<{ status: ManagedSubmission['events'][number]['status']; on_date: string }>();
  return {
    v: row.v,
    answers: JSON.parse(row.answers) as SurveyAnswers,
    env: readEnv(row.env),
    createdOn: row.created_on,
    updatedOn: row.updated_on,
    events: results.map((e) => ({ status: e.status, onDate: e.on_date })),
  };
}

const notFound = () => reply({ ok: false, error: 'not_found' }, 404);

async function handleGet(req: Request, env: Env): Promise<Response> {
  const row = await findByKey(req, env);
  if (!row) return notFound();
  return reply({ ok: true, submission: await load(row, env) });
}

/** 两种改法：更新账号状态相关字段，或补答第 2 版新题（只能填空）。并进原答案后按问卷版本整份重新校验；状态变了记一条事件 */
async function handleUpdate(req: Request, env: Env): Promise<Response> {
  const row = await findByKey(req, env);
  if (!row) return notFound();
  const input = await readJson(req);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return reply({ ok: false, error: 'bad_request' }, 400);
  const body = input as Record<string, unknown>;

  const current = JSON.parse(row.answers) as SurveyAnswers;
  const merged: Record<string, unknown> = { ...current };
  if ('supplement' in body) {
    const s = body.supplement;
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return reply({ ok: false, error: 'bad_request' }, 400);
    for (const f of SUPPLEMENT_FIELDS) if (current[f] === undefined) merged[f] = (s as Record<string, unknown>)[f];
  } else {
    for (const f of STATUS_FIELDS) merged[f] = body[f];
  }
  const date = today();
  const checked = validateAnswers(merged, date, row.v);
  if (!checked.ok) return reply({ ok: false, error: 'invalid', field: checked.field }, 400);
  const next = checked.value;

  const statements = [
    env.DB.prepare('UPDATE submissions SET status = ?1, answers = ?2, updated_on = ?3 WHERE id = ?4').bind(
      next.status,
      JSON.stringify(next),
      date,
      row.id,
    ),
  ];
  if (next.status !== current.status) {
    statements.push(env.DB.prepare('INSERT INTO status_events (submission_id, status, on_date) VALUES (?1, ?2, ?3)').bind(row.id, next.status, date));
  }
  try {
    await env.DB.batch(statements);
  } catch {
    return reply({ ok: false, error: 'server' }, 500);
  }
  return reply({ ok: true, submission: await load({ ...row, answers: JSON.stringify(next), updated_on: date }, env) });
}

async function handleDelete(req: Request, env: Env): Promise<Response> {
  const row = await findByKey(req, env);
  if (!row) return notFound();
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM status_events WHERE submission_id = ?1').bind(row.id),
      env.DB.prepare('DELETE FROM submissions WHERE id = ?1').bind(row.id),
    ]);
  } catch {
    return reply({ ok: false, error: 'server' }, 500);
  }
  return reply({ ok: true });
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/submissions' && req.method === 'POST') return handleSubmit(req, env);
    if (pathname === '/api/stats' && req.method === 'GET') return handleStats(env);
    if (pathname === '/api/board' && req.method === 'GET') return handleBoard(env);
    if (pathname === '/api/submission') {
      if (req.method === 'GET') return handleGet(req, env);
      if (req.method === 'PATCH') return handleUpdate(req, env);
      if (req.method === 'DELETE') return handleDelete(req, env);
    }
    return reply({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
