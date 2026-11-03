import { defineTable } from "@morlay/rdbkit";

export const schemaMeta = defineTable({
  name: "t_schema_meta",
  columns: {
    f_key: { type: "text", primaryKey: true },
    f_value: { type: "text", notNull: true },
  },
});
