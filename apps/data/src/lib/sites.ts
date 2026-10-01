// 两个站互相链接用的地址；本地开发时检测站跑在 :4321

export const DETECT_URL = import.meta.env.DEV ? 'http://localhost:4321/' : 'https://claude-analysis.ohaze.workers.dev/';
