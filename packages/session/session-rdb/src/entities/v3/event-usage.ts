import type { TableDef } from "../../adapters/types.ts";

/**
 * 用量日志：一条 `assistant/message` 事件一行（按事件行唯一，fork 共享行不重复）。
 * 读侧维度全部物化在行上——本地日、是否被会话引用、是否被子代理会话引用——统计因此不做
 * `EXISTS` 判定、也不回连事件表；事件行本身仍留在 `t_events`。
 * 取舍见 ADR-统计衍生表物化归属与汇总。
 */
export const eventUsage: TableDef = {
  name: "t_event_usage",
  columns: {
    f_event_id: {
      type: "text",
      primaryKey: true,
      references: { table: "t_events", column: "f_event_id", onDelete: "cascade" },
    },
    // 毫秒时间戳：SQLite 的 integer 是 64 位，PG 的 integer 只有 int4（21 亿上限）——必须是 bigint。
    f_created_at: { type: "bigint", notNull: true },
    // host 本地日 `YYYY-MM-DD`（与统计桶的 localtime 口径一致）。
    f_day: { type: "text", notNull: true },
    f_provider: { type: "text" },
    f_model: { type: "text" },
    // 被任何会话桥接行引用（孤儿 0，不计入统计）/ 被任何 subagent 会话引用（拆「人类 / 子代理」）。
    f_referenced: { type: "integer", notNull: true, default: 0 },
    f_subagent: { type: "integer", notNull: true, default: 0 },
    f_input_tokens: { type: "integer", notNull: true, default: 0 },
    f_output_tokens: { type: "integer", notNull: true, default: 0 },
    f_cache_read_tokens: { type: "integer", notNull: true, default: 0 },
    f_reasoning_tokens: { type: "integer", notNull: true, default: 0 },
    f_total_tokens: { type: "integer", notNull: true, default: 0 },
  },
  indexes: { idx_event_usage_created_at: { columns: ["f_created_at"] } },
};
