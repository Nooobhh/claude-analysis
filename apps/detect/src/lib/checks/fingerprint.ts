/*
 * 环境指纹检测：时区、语言、区域格式、中文字体、国产浏览器与设备。
 * 检测规则改写自 FuckClaude（src/config/signals.ts），去掉加权评分，只按规则标状态。
 *
 * Portions Copyright (c) 2026 LinXiaoTao (https://github.com/LinXiaoTao/FuckClaude)
 * Licensed under the MIT License:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { LocalSnapshot } from '@claude-analysis/shared';
import type { Result } from '../result';
import { CN_TIMEZONES, HKMO_TIMEZONES } from '../regions';

export interface Fingerprint {
  timezone: string;
  /** 当前 UTC 偏移（分钟，东正西负） */
  offsetMin: number;
  languages: string[];
  locale: string;
}

export function readFingerprint(): Fingerprint {
  let timezone = '';
  let locale = '';
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    timezone = opts.timeZone ?? '';
    locale = opts.locale ?? '';
  } catch {
    /* 极老浏览器，留空 */
  }
  const languages = (navigator.languages?.length ? [...navigator.languages] : [navigator.language]).filter(Boolean);
  return { timezone, offsetMin: -new Date().getTimezoneOffset(), languages, locale };
}

/** 结果码用：系统家族（UA 判断，iPadOS 桌面模式会归为 macos） */
export function osFamily(): LocalSnapshot['fp']['os'] {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'windows';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/Linux/.test(ua) && !/CrOS/.test(ua)) return 'linux';
  return 'other';
}

/** 结果码用：浏览器家族；国产浏览器多是 Chromium 内核，归为 chrome，具体名字另见 cnBrowser */
export function browserFamily(): LocalSnapshot['fp']['browser'] {
  const ua = navigator.userAgent;
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/Firefox|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome|CriOS|Chromium/.test(ua)) return 'chrome';
  if (/Safari/.test(ua)) return 'safari';
  return 'other';
}

export function formatOffset(min: number): string {
  const sign = min >= 0 ? '+' : '-';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export function checkTimezone(fp: Fingerprint): Result {
  const value = [`${fp.timezone || '未知'}（${formatOffset(fp.offsetMin)}）`];
  if (CN_TIMEZONES.includes(fp.timezone)) return { status: 'warn', tag: '中国时区', value, reason: '系统时区是中国大陆时区' };
  if (HKMO_TIMEZONES.includes(fp.timezone)) return { status: 'warn', tag: '港澳时区', value, reason: '系统时区是香港 / 澳门时区，都不在 Claude 支持地区内' };
  return { status: 'ok', value };
}

const isTW = (l: string) => l.startsWith('zh-tw') || (l.includes('hant') && l.includes('tw'));
const isHKMO = (l: string) => l.startsWith('zh-hk') || l.startsWith('zh-mo');
/** 简体中文：zh-CN / zh-Hans / 不带地区的 zh（排在繁体之后的 zh 只是繁体的兜底，不算） */
function isHansAt(list: string[], i: number): boolean {
  const l = list[i];
  const firstTrad = list.findIndex((x) => isTW(x) || isHKMO(x) || x.includes('hant'));
  return l.startsWith('zh-cn') || l.includes('hans') || (l === 'zh' && (firstTrad === -1 || i < firstTrad));
}

/** 浏览器首选语言是否为简体中文（交叉比对也用） */
export function primaryIsHans(languages: string[]): boolean {
  const list = languages.map((l) => l.toLowerCase());
  return list.length > 0 && isHansAt(list, 0);
}

export function checkLanguage(fp: Fingerprint): Result {
  const list = fp.languages.map((l) => l.toLowerCase());
  const value = [fp.languages.join(', ') || '未知'];
  if (primaryIsHans(fp.languages)) return { status: 'warn', tag: '简体中文', value, reason: '首选语言是简体中文' };
  if (list[0] && isHKMO(list[0])) return { status: 'warn', tag: '港澳中文', value, reason: '首选语言是香港 / 澳门中文' };
  if (list.some((_, i) => isHansAt(list, i))) return { status: 'warn', tag: '含简体中文', value, reason: '语言列表里包含简体中文' };
  return { status: 'ok', value };
}

export function checkLocale(fp: Fingerprint): Result {
  const l = fp.locale.toLowerCase();
  const value = [fp.locale || '未知'];
  if (l.startsWith('zh-cn') || l.includes('hans') || l === 'zh') return { status: 'warn', tag: '简体中文', value, reason: '日期、数字按简体中文格式显示' };
  if (isHKMO(l)) return { status: 'warn', tag: '港澳格式', value, reason: '日期、数字按香港 / 澳门格式显示' };
  return { status: 'ok', value };
}

const FONTS_SC = [
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'SimSun',
  'NSimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
  'DengXian',
  'PingFang SC',
  'Hiragino Sans GB',
  'STHeiti',
  'STSong',
  'Songti SC',
  'Source Han Sans CN',
  'Source Han Sans SC',
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
];

/** 国产厂商 / 国产软件自带字体，基本只出现在国产设备或装了 WPS 等软件的环境 */
const FONTS_CN_VENDOR = [
  'MiSans',
  'MIUI',
  'HarmonyOS Sans SC',
  'HarmonyOS Sans',
  'HONOR Sans',
  'OPPO Sans',
  'vivo Sans',
  'Alibaba PuHuiTi',
  'Alibaba Sans',
  'DingTalk JinBuTi',
  'Douyin Sans',
  'HYQiHei',
  'FZShuSong-Z01S',
  'FZKai-Z03S',
  'FZHei-B01S',
  'FZFangSong-Z02S',
];

/** 各系统默认自带的简体中文字体：英文系统也有，单独出现不说明问题 */
function osDefaultFonts(): string[] {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(ua)) return ['PingFang SC', 'Hiragino Sans GB', 'STHeiti', 'STSong', 'Songti SC'];
  if (/Windows/.test(ua)) return ['Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun'];
  if (/Linux|Android|CrOS/.test(ua)) return ['Noto Sans CJK SC', 'Noto Serif CJK SC'];
  return [];
}

function isFontAvailable(font: string, ctx: CanvasRenderingContext2D): boolean {
  const text = '中文字体检测ABCabc012';
  return ['monospace', 'sans-serif', 'serif'].some((base) => {
    ctx.font = `72px ${base}`;
    const baseWidth = ctx.measureText(text).width;
    ctx.font = `72px "${font}", ${base}`;
    return Math.abs(ctx.measureText(text).width - baseWidth) > 0.5;
  });
}

export function checkFonts(): Result {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return { status: 'unknown', tag: '无法检测', value: [], reason: '浏览器禁用了 canvas' };
  const defaults = osDefaultFonts();
  const sc = FONTS_SC.filter((f) => isFontAvailable(f, ctx));
  const vendor = FONTS_CN_VENDOR.filter((f) => isFontAvailable(f, ctx));
  const extra = [...sc.filter((f) => !defaults.includes(f)), ...vendor];
  const all = [...sc, ...vendor];
  const value = [all.join(', ')];
  if (extra.length) return { status: 'warn', tag: '中文环境字体', value, reason: `${extra.slice(0, 3).join('、')} 通常只在中文系统、中文语言包或国产软件环境里出现` };
  if (sc.length) return { status: 'ok', tag: '仅系统自带', value, reason: '只有系统自带的中文字体，英文系统也有' };
  return { status: 'ok', tag: '未检测到', value };
}

/** 国产浏览器与 App 内置浏览器，匹配 UA 与 UA-CH 品牌 */
const CN_BROWSERS: Array<[RegExp, string]> = [
  [/micromessenger|wxwork/i, '微信'],
  [/mqqbrowser|qqbrowser|\bqq\//i, 'QQ 浏览器'],
  [/quark/i, '夸克'],
  [/ucbrowser|ucweb/i, 'UC 浏览器'],
  [/baiduboxapp|bidubrowser|baidubrowser/i, '百度'],
  [/miuibrowser|xiaomi\/|mibrowser/i, '小米浏览器'],
  [/huaweibrowser/i, '华为浏览器'],
  [/heytapbrowser|oppobrowser/i, 'OPPO 浏览器'],
  [/vivobrowser/i, 'vivo 浏览器'],
  [/sogoumobilebrowser|\bmetasr\b|\bse 2\.x\b/i, '搜狗浏览器'],
  [/maxthon/i, '傲游'],
  [/360se|360ee|qihoobrowser|\bqhbrowser\b/i, '360 浏览器'],
  [/2345explorer|2345browser/i, '2345 浏览器'],
  [/lbbrowser/i, '猎豹浏览器'],
  [/theworld/i, '世界之窗'],
  [/aweme|bytedancewebview|newsarticle|toutiaomicroapp/i, '抖音 / 今日头条'],
  [/alipayclient/i, '支付宝'],
  [/dingtalk/i, '钉钉'],
  [/weibo/i, '微博'],
  [/xiaohongshu|xhsminiapp/i, '小红书'],
  [/\bbilibili\b/i, '哔哩哔哩'],
];

/** 国产设备品牌 / 系统，匹配 UA 与 UA-CH 设备型号 */
const CN_DEVICES: Array<[RegExp, string]> = [
  [/harmonyos|openharmony/i, 'HarmonyOS'],
  [/huawei|\bhonor\b/i, '华为 / 荣耀'],
  [/meizu/i, '魅族'],
  [/nubia|\bzte\b/i, '中兴 / 努比亚'],
  [/xiaomi|redmi|\bpoco\b|\bm2\d{3}[a-z0-9]+\b/i, '小米'],
  [/oppo|\bpd[a-z]m\d{2}\b/i, 'OPPO'],
  [/vivo|\bv2\d{3}[a-z]{1,2}\b/i, 'vivo'],
  [/realme|\brmx\d{4}\b/i, 'realme'],
  [/oneplus/i, '一加'],
  [/\blenovo\b|\bzuk\b/i, '联想'],
];

interface UAData {
  brands?: Array<{ brand: string }>;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

const uaData = () => (navigator as Navigator & { userAgentData?: UAData }).userAgentData;

export function checkBrowser(): Result {
  const probe = `${navigator.userAgent} ${(uaData()?.brands ?? []).map((b) => b.brand).join(' ')}`;
  const hit = CN_BROWSERS.find(([re]) => re.test(probe));
  if (hit) return { status: 'warn', tag: '国产', value: [hit[1]], reason: '国产浏览器或 App 内置浏览器' };
  return { status: 'ok', tag: '未检测到', value: [] };
}

export async function checkDevice(): Promise<Result> {
  // Android 的 UA 精简后看不到型号，用 UA-CH 高熵值补回
  let extra = '';
  try {
    const high = await uaData()?.getHighEntropyValues?.(['model', 'platform']);
    if (high) extra = ` ${String(high.model ?? '')} ${String(high.platform ?? '')}`;
  } catch {
    /* 用户或浏览器拒绝，退回普通 UA */
  }
  const hit = CN_DEVICES.find(([re]) => re.test(`${navigator.userAgent}${extra}`));
  if (hit) return { status: 'warn', tag: '国产', value: [hit[1]], reason: '国产设备品牌或系统' };
  return { status: 'ok', tag: '未检测到', value: [] };
}
