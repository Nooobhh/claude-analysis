-- 问卷提交：一行 = 一个 Claude 账号。不存任何 IP，时间只到日期
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  -- 管理链接密钥的 SHA-256；密钥本身只在提交时返回一次
  key_hash TEXT NOT NULL UNIQUE,
  -- 问卷 schema 版本（SURVEY_VERSION）
  v INTEGER NOT NULL,
  -- 当前账号状态，与 answers.status 相同；单独一列方便统计
  status TEXT NOT NULL,
  -- 校验后的答案（SurveyAnswers JSON）
  answers TEXT NOT NULL,
  -- detect = 检测站结果码，manual = 手动填写
  env_source TEXT NOT NULL,
  -- 网络环境（JSON：same、exitType，手动路径另有 answers）；不存结果码原文
  env TEXT NOT NULL,
  -- 检测快照（DetectSnapshot JSON），只有 detect 有
  snapshot TEXT,
  -- 结果码签名段的 SHA-256：一个结果码只能提交一次
  code_hash TEXT UNIQUE,
  created_on TEXT NOT NULL,
  updated_on TEXT NOT NULL
);

-- 账号状态变化：提交时记一条，之后每次改状态再记一条；看板据此按「账号·月」算风险
CREATE TABLE status_events (
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  on_date TEXT NOT NULL
);

CREATE INDEX status_events_submission ON status_events (submission_id);
