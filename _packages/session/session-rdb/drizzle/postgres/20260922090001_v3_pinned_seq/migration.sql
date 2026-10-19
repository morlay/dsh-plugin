-- 见 SQLite 侧同名迁移的说明：钉住的会话集合用会话行的序号列表达。
ALTER TABLE "t_sessions" ADD COLUMN "f_pinned_seq" integer;
