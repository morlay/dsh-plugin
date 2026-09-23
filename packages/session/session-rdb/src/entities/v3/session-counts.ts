import type { TableDef } from "../../adapters/types.ts";

/**
 * 会话 × 本地日的活动计数（派生统计表）：轮次 / 步骤 / 用户输入 / 工具调用四列直接读，
 * 不再存事件类型、也不在读取时折。旁路累加、可按会话重建，读侧只读；
 * 取舍见 ADR-统计衍生表物化归属与汇总。
 */
export const sessionCounts: TableDef = {
  name: "t_session_counts",
  columns: {
    f_session_id: {
      type: "text",
      notNull: true,
      references: { table: "t_sessions", column: "f_session_id", onDelete: "cascade" },
    },
    f_day: { type: "text", notNull: true },
    f_turns: { type: "integer", notNull: true, default: 0 },
    f_steps: { type: "integer", notNull: true, default: 0 },
    f_user_inputs: { type: "integer", notNull: true, default: 0 },
    f_tool_calls: { type: "integer", notNull: true, default: 0 },
  },
  uniques: { uq_session_counts_key: { columns: ["f_session_id", "f_day"] } },
};
