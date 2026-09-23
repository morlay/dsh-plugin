import type { TableDef } from "../../adapters/types.ts";

/**
 * 会话 × 本地日 × 模型的 token 汇总（派生统计表）：**按会话的行**读它，因此保住
 * 「fork 子会话含继承前缀」的口径（各会话行之和 ≥ 总量）而不回连事件表。
 * 旁路累加、可按会话重建，读侧只读；取舍见 ADR-统计衍生表物化归属与汇总。
 */
export const sessionUsage: TableDef = {
  name: "t_session_usage",
  columns: {
    f_session_id: {
      type: "text",
      notNull: true,
      references: { table: "t_sessions", column: "f_session_id", onDelete: "cascade" },
    },
    f_day: { type: "text", notNull: true },
    // 模型未知时落空串（不是 NULL）：唯一键里的 NULL 在 SQLite 下互不冲突，空串才保证一行。
    f_provider: { type: "text", notNull: true, default: "" },
    f_model: { type: "text", notNull: true, default: "" },
    f_input_tokens: { type: "integer", notNull: true, default: 0 },
    f_output_tokens: { type: "integer", notNull: true, default: 0 },
    f_cache_read_tokens: { type: "integer", notNull: true, default: 0 },
    f_reasoning_tokens: { type: "integer", notNull: true, default: 0 },
    f_total_tokens: { type: "integer", notNull: true, default: 0 },
  },
  uniques: {
    uq_session_usage_key: { columns: ["f_session_id", "f_day", "f_provider", "f_model"] },
  },
};
