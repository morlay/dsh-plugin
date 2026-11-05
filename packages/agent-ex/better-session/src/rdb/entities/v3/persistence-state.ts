import { defineTable } from "@morlay/zephyr-rdb";

export const persistenceState = defineTable({
  name: "t_persistence_state",
  columns: {
    f_singleton: { type: "integer", primaryKey: true },
    f_store_id: { type: "text", notNull: true },
  },
  checks: { ck_persistence_state_singleton: { expression: "f_singleton = 1" } },
});
