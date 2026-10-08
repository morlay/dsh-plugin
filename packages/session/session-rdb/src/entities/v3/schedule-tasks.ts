import type { TableDef } from "../../adapters/types.ts";

// 官方 `schedule` 域的 `tasks` 表：一个提醒一行（key = `ScheduleId`）。归属会话与状态是可查的列，
// 记录本体与投递回执按上游契约原样存 JSON（它们只有上游 `dsh-schedule` 自己消费，拆列没有第二个读法）。
export const scheduleTasks: TableDef = {
  name: "t_schedule_tasks",
  columns: {
    f_id: { type: "text", primaryKey: true },
    f_session_id: { type: "text", notNull: true },
    f_status: { type: "text", notNull: true },
    f_record: { type: "text", notNull: true },
    f_last_delivery: { type: "text" },
    f_delivery_history: { type: "text" },
  },
  indexes: { idx_schedule_tasks_session_id: { columns: ["f_session_id"] } },
};
