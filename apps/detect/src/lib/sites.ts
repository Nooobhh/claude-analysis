// 问卷站（短期附属站点）地址。问卷站下线时：删掉这里、检测页的「复制结果码」按钮与说明
export const SURVEY_URL = import.meta.env.DEV ? 'http://localhost:4322/' : 'https://claudeban.ohaze.workers.dev/';
