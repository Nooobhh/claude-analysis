// 检测站结果码的验签公钥（Ed25519 raw，base64url），与检测站 Worker 的 RESULT_CODE_KEY 私钥成对。
// 换密钥时两边一起换；公钥本来就是公开的，可以写在代码里
export const RESULT_CODE_PUBLIC_KEY = 'uRnHhFtC9-DlJvNcxSuLTSlSWgN2HdpWYf118oHSWV8';
