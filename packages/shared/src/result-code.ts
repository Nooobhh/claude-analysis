// 结果码：CA1.<signed>.<sig>.<local>，各段都是 base64url（JSON 先转 UTF-8）。
// signed 段由检测站 Worker 用 Ed25519 私钥签名（签的是 signed 段的 base64url 文本）；local 段是浏览器本地结论，不签名。
// 检测站 Worker 签名、检测页拼装、问卷站（浏览器与服务器）校验；只用 WebCrypto，浏览器与 Workers 通用
import type { IpInfo } from './index';
import { SNAPSHOT_VERSION, type DetectSnapshot, type LocalSnapshot, type SignedSnapshot, type SnapshotIp } from './snapshot';

export const RESULT_CODE_PREFIX = 'CA1';
/** 有效期（秒），从检测站查询 IP 属性时算起 */
export const RESULT_CODE_TTL = 3600;
/** 允许的时钟偏差（秒） */
const CLOCK_SKEW = 300;

const ED25519 = { name: 'Ed25519' };

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 同时接受 base64url 与标准 base64 */
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const encodeJson = (v: unknown) => toB64url(new TextEncoder().encode(JSON.stringify(v)));
const decodeJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(fromB64url(s))) as T;

/** IpInfo → 签名用的 IP 属性（不含 IP 本身、城市、时区） */
export function snapshotIpOf(info: IpInfo): SnapshotIp {
  return {
    country: info.countryCode,
    asn: info.asn,
    org: info.org,
    typeBy: info.risk?.typeBy ?? {},
    flaggedBy: info.risk?.flaggedBy ?? null,
    riskScore: info.risk?.riskScore ?? null,
    regCountry: info.registration?.country ?? null,
  };
}

/** 检测站 Worker：PKCS#8 私钥（base64） */
export const importSigningKey = (pkcs8: string) => crypto.subtle.importKey('pkcs8', fromB64url(pkcs8), ED25519, false, ['sign']);

/** 问卷站：raw 公钥（base64url）；不支持 Ed25519 的旧浏览器会抛错 */
export const importVerifyKey = (raw: string) => crypto.subtle.importKey('raw', fromB64url(raw), ED25519, false, ['verify']);

/** 检测站 Worker 签名，返回 `<signed>.<sig>`，由检测页拼上 local 段 */
export async function signSnapshot(ip: SnapshotIp, key: CryptoKey, now = Date.now()): Promise<string> {
  const signed: SignedSnapshot = {
    v: SNAPSHOT_VERSION,
    at: Math.floor(now / 1000),
    n: toB64url(crypto.getRandomValues(new Uint8Array(8))),
    ip,
  };
  const payload = encodeJson(signed);
  const sig = await crypto.subtle.sign(ED25519, key, new TextEncoder().encode(payload));
  return `${payload}.${toB64url(new Uint8Array(sig))}`;
}

/** 检测页：拼出完整结果码 */
export const composeResultCode = (signedPart: string, local: LocalSnapshot) =>
  `${RESULT_CODE_PREFIX}.${signedPart}.${encodeJson(local)}`;

export type ResultCodeError = 'format' | 'signature' | 'expired';

export type ResultCodeCheck =
  /** verified = false：当前浏览器不支持 Ed25519、没能校验签名（提交时由服务器校验） */
  | { ok: true; snapshot: DetectSnapshot; verified: boolean }
  | { ok: false; error: ResultCodeError };

/** 问卷站：解析并校验结果码；key 传 null 表示只解析不验签 */
export async function verifyResultCode(code: string, key: CryptoKey | null, now = Date.now()): Promise<ResultCodeCheck> {
  const parts = code.trim().split('.');
  if (parts.length !== 4 || parts[0] !== RESULT_CODE_PREFIX) return { ok: false, error: 'format' };
  const [, payload, sig, localPart] = parts;

  let snapshot: DetectSnapshot;
  try {
    snapshot = { signed: decodeJson<SignedSnapshot>(payload), local: decodeJson<LocalSnapshot>(localPart) };
  } catch {
    return { ok: false, error: 'format' };
  }
  const { signed, local } = snapshot;
  if (signed?.v !== SNAPSHOT_VERSION || typeof signed.at !== 'number' || !signed.ip || !local?.fp || !local.leak || !local.status) {
    return { ok: false, error: 'format' };
  }

  if (key) {
    const valid = await crypto.subtle
      .verify(ED25519, key, fromB64url(sig), new TextEncoder().encode(payload))
      .catch(() => false);
    if (!valid) return { ok: false, error: 'signature' };
  }

  const age = now / 1000 - signed.at;
  if (age > RESULT_CODE_TTL || age < -CLOCK_SKEW) return { ok: false, error: 'expired' };
  return { ok: true, snapshot, verified: key !== null };
}
