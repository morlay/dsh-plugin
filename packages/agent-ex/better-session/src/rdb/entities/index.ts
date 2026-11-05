import { defineCatalog } from "@morlay/zephyr-rdb";
import { sqliteTableDefs } from "./v3/index.ts";

export { sqliteTableDefs, postgresTableDefs } from "./v3/index.ts";

/** 库结构的唯一事实来源（DDL、迁移与表句柄都从它算出来）。 */
export const catalog = defineCatalog(sqliteTableDefs);
export { storageRecords } from "./v3/storage-records.ts";
export { sessionProjcacheRows } from "./v3/session-projcache-rows.ts";
export { persistenceState } from "./v3/persistence-state.ts";
export { sessions } from "./v3/sessions.ts";
export { events } from "./v3/events.ts";
export { sessionEvents } from "./v3/session-events.ts";
export { eventUsage } from "./v3/event-usage.ts";
export { sessionUsage } from "./v3/session-usage.ts";
export { sessionCounts } from "./v3/session-counts.ts";
export { storageUnits } from "./v3/storage-units.ts";
