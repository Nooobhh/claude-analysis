// 从 APNIC 分配表生成中国大陆 IPv4 段（public/cn-ipv4.bin），供浏览器本地判断 WebRTC 泄露的 IP 是否在大陆
// 格式：按起点升序、已合并的 [start, end] uint32 对，小端序。运行：pnpm --filter @claude-analysis/detect gen:cn-ipv4
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://ftp.apnic.net/stats/apnic/delegated-apnic-latest';
const text = await (await fetch(SOURCE)).text();

const toInt = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const ranges = text
  .split('\n')
  .filter((line) => line.startsWith('apnic|CN|ipv4|'))
  .map((line) => {
    const [, , , start, count] = line.split('|');
    const s = toInt(start);
    return [s, s + Number(count) - 1];
  })
  .sort((a, b) => a[0] - b[0]);

const merged = [];
for (const r of ranges) {
  const last = merged.at(-1);
  if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
  else merged.push([...r]);
}

const buf = Buffer.alloc(merged.length * 8);
merged.forEach(([s, e], i) => {
  buf.writeUInt32LE(s, i * 8);
  buf.writeUInt32LE(e, i * 8 + 4);
});
writeFileSync(new URL('../public/cn-ipv4.bin', import.meta.url), buf);
console.log(`${ranges.length} 条 → 合并为 ${merged.length} 段，${buf.length} 字节`);
