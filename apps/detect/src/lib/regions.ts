// 地区与时区常量

export { SUPPORTED_COUNTRIES } from '@claude-analysis/shared';

/** 中国大陆时区（含历史别名） */
export const CN_TIMEZONES = ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Kashgar'];

/** 香港 / 澳门：Claude 不支持地区 */
export const HKMO_TIMEZONES = ['Asia/Hong_Kong', 'Asia/Macau'];

/** 使用中文的地区：IP 在这些地区时浏览器用中文不算矛盾 */
export const ZH_SPEAKING = new Set(['CN', 'HK', 'MO', 'TW', 'SG', 'MY']);
