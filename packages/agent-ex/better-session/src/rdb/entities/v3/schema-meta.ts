import { defineTable } from "@morlay/zephyr-rdb";

export const schemaMeta = defineTable({
  name: "t_schema_meta",
  columns: {
    f_key: { type: "text", primaryKey: true },
    f_value: { type: "text", notNull: true },
  },
});
