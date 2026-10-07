// 检测结果的展示模型（检测脚本产出，页面渲染消费）
import type { Status } from '@claude-analysis/shared';

/** 值片段：普通文本、按「显示 IP」开关打码的 IP、国旗（ISO 国家代码） */
export type Part = string | { ip: string } | { flag: string };

export interface Detail {
  label: string;
  value: Part[];
  status?: Status;
  /** 一句结论，泄露卡片用（如「与 Claude 出口一致」） */
  note?: string;
}

export interface Result {
  /** 缺省 = 纯信息项，不参与异常 / 注意计数 */
  status?: Status;
  /** 标签文字（如「未检测到」「8/8 一致」）；缺省显示状态名 */
  tag?: string;
  value: Part[];
  reason?: string;
  /** 折叠的明细；泄露检测项则是逐个服务器的结果，画成泄露卡片 */
  details?: Detail[];
}

export const ip = (value: string): Part => ({ ip: value });

/** 合法国家代码才出国旗，便于直接展开进 value */
export const flag = (cc: string | null | undefined): Part[] => (cc && /^[A-Z]{2}$/.test(cc) ? [{ flag: cc }] : []);
