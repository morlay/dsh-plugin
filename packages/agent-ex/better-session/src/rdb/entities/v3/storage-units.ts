import { defineTable } from "@morlay/zephyr-rdb";

export const storageUnits = defineTable({
  name: "t_storage_units",
  columns: {
    f_name: { type: "text", primaryKey: true },
    f_version: { type: "integer", notNull: true },
  },
});
