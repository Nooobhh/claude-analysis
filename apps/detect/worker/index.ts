// 检测站 Worker：只处理 /api/*，其余请求由静态资源直接响应（见 wrangler.jsonc run_worker_first）
// 隐私：不打日志、不存请求者 IP；缓存 key 与限频 key 都是加盐哈希
import type { IpApiResponse, ServiceStatus, StatusApiResponse } from '@claude-analysis/shared';
import { hashIp, isPublicIp, lookupIp, type Secrets } from './ip';

const IP_CACHE_TTL = 86400;
// RDAP 偶发失败时缩短缓存，避免「原生 IP」一整天查不到
const IP_CACHE_TTL_PARTIAL = 3600;
// 数据源或返回结构变化时递增，旧缓存自然过期
const IP_CACHE_VERSION = 7;

function reply(body: unknown, status = 200, cacheControl = 'no-store'): Response {
  return Response.json(body, { status, headers: { 'cache-control': cacheControl } });
}

async function handleIp(req: Request, env: Env & Secrets): Promise<Response> {
  const body = await req.json<{ ip?: unknown }>().catch(() => null);
  const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
  if (!isPublicIp(ip)) return reply({ ok: false, error: 'bad_request' } satisfies IpApiResponse, 400);

  const salt = env.IP_HASH_SALT ?? '';
  const cacheKey = salt ? `ip:v${IP_CACHE_VERSION}:${await hashIp(ip, salt)}` : null;
  if (cacheKey) {
    const cached = await env.IP_CACHE.get(cacheKey, 'json').catch(() => null);
    if (cached) return reply({ ok: true, data: cached } as IpApiResponse);
  }

  // 只对要打到上游的请求限频：查自己的出口放宽；查别的 IP（分流导致访问本站与访问 Claude 出口不同）收紧
  const requester = req.headers.get('cf-connecting-ip') ?? '';
  const limiter = ip === requester ? env.RL_SELF : env.RL_OTHER;
  const { success } = await limiter.limit({ key: await hashIp(requester, salt) });
  if (!success) return reply({ ok: false, error: 'rate_limited' } satisfies IpApiResponse, 429);

  const data = await lookupIp(ip, env);
  if (!data) return reply({ ok: false, error: 'upstream' } satisfies IpApiResponse, 502);
  // KV 免费额度写满时 put 会失败，不影响本次返回
  const ttl = data.registration ? IP_CACHE_TTL : IP_CACHE_TTL_PARTIAL;
  if (cacheKey) await env.IP_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl }).catch(() => {});
  return reply({ ok: true, data } satisfies IpApiResponse);
}

interface StatuspageSummary {
  status: { indicator: string; description: string };
  components: Array<{ name: string; status: string; group: boolean; group_id: string | null }>;
  incidents: Array<{ name: string; impact: string }>;
}

// status.claude.com 不允许跨域读取，由 Worker 中转
async function handleStatus(): Promise<Response> {
  const res = await fetch('https://status.claude.com/api/v2/summary.json', {
    cf: { cacheTtl: 60, cacheEverything: true },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return reply({ ok: false, error: 'upstream' } satisfies StatusApiResponse, 502);
  const d = await res.json<StatuspageSummary>();
  const data: ServiceStatus = {
    indicator: d.status.indicator,
    description: d.status.description,
    components: d.components.filter((c) => !c.group && !c.group_id).map((c) => ({ name: c.name, status: c.status })),
    incidents: d.incidents.map((i) => ({ name: i.name, impact: i.impact })),
  };
  return reply({ ok: true, data } satisfies StatusApiResponse, 200, 'public, max-age=60');
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/ip' && req.method === 'POST') return handleIp(req, env);
    if (pathname === '/api/status' && req.method === 'GET') return handleStatus();
    return reply({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env & Secrets>;
