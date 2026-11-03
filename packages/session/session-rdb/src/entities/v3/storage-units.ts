import { defineTable } from "@morlay/rdbkit";

export const storageUnits = defineTable({
  name: "t_storage_units",
  columns: {
    f_name: { type: "text", primaryKey: true },
    f_version: { type: "integer", notNull: true },
  },
});
