// 可用性：到 Anthropic 的延迟 + 官方服务状态（经本站 Worker 中转）
import type { Status, StatusApiResponse } from '@claude-analysis/shared';
import { fetchWithTimeout, median, type Trace } from '../net';
import type { Detail, Result } from '../result';

const SLOW_MS = 1000;

/** 单个域名的延迟：多次请求取中位数（首次含建连，中位数能排除它） */
export function judgeLatency(samples: Array<Trace | null>): Result {
  const ms = samples.filter((t): t is Trace => t !== null).map((t) => t.ms);
  if (!ms.length) return { status: 'bad', tag: '无法连接', value: [], reason: '多次请求都失败' };
  const m = median(ms);
  if (m >= SLOW_MS) return { status: 'warn', tag: '偏慢', value: [`${m} ms`], reason: '延迟偏高，对话和 Claude Code 可能卡顿' };
  return { status: 'ok', tag: '正常', value: [`${m} ms`] };
}

export async function fetchStatus(): Promise<StatusApiResponse | null> {
  try {
    const res = await fetchWithTimeout('/api/status', { cache: 'default', timeoutMs: 8000 });
    return (await res.json()) as StatusApiResponse;
  } catch {
    return null;
  }
}

const INDICATOR: Record<string, [Status, string]> = {
  none: ['ok', '全部正常'],
  minor: ['warn', '部分服务降级'],
  maintenance: ['warn', '维护中'],
  major: ['bad', '部分服务中断'],
  critical: ['bad', '严重故障'],
};

const COMPONENT: Record<string, [Status | undefined, string]> = {
  operational: [undefined, '正常'],
  degraded_performance: ['warn', '性能下降'],
  partial_outage: ['bad', '部分中断'],
  major_outage: ['bad', '严重中断'],
  under_maintenance: ['warn', '维护中'],
};

export function judgeStatus(r: StatusApiResponse | null): Result {
  if (!r?.ok) return { status: 'unknown', tag: '读取失败', value: [], reason: '官方状态页暂时无法读取' };
  const [status, tag] = INDICATOR[r.data.indicator] ?? ['unknown', r.data.description];
  const details: Detail[] = r.data.components.map((c) => {
    const [s, text] = COMPONENT[c.status] ?? ['unknown', c.status];
    return { label: c.name, value: [text], status: s };
  });
  const reason = r.data.incidents.length ? `进行中的事件：${r.data.incidents.map((i) => i.name).join('；')}` : undefined;
  return { status, tag, value: [], reason, details };
}
