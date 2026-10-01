// 国旗 SVG 来自 flag-icons（MIT，Copyright (c) 2013 Panayiotis Lipiridis）
// 构建时每面旗输出为独立静态文件（不内联），页面只下载实际用到的几面
const files = import.meta.glob<string>('../../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

const byCode = new Map(Object.entries(files).map(([path, url]) => [path.slice(-6, -4).toUpperCase(), url]));

export const flagUrl = (cc: string): string | undefined => byCode.get(cc.toUpperCase());
