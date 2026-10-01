// 本地判断 IPv4 是否属于中国大陆：数据是 APNIC 分配表生成的 /cn-ipv4.bin（scripts/gen-cn-ipv4.mjs）
// 用于 WebRTC 泄露的 IP——它可能就是用户的宽带 IP，按隐私红线不能发给后端查归属地

let table: Promise<Uint32Array | null> | undefined;

const load = () =>
  (table ??= fetch('/cn-ipv4.bin')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((b) => (b ? new Uint32Array(b) : null))
    .catch(() => null));

/** true / false；IPv6 或数据加载失败时返回 null */
export async function isMainlandIp(ip: string): Promise<boolean | null> {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const n = ((Number(m[1]) << 24) >>> 0) + (Number(m[2]) << 16) + (Number(m[3]) << 8) + Number(m[4]);
  const t = await load();
  if (!t) return null;
  // 表内是按起点升序的 [start, end] 对，二分查找
  let lo = 0;
  let hi = t.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (n < t[mid * 2]) hi = mid - 1;
    else if (n > t[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}
