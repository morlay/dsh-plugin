import { persistenceState } from "./persistence-state.ts";
import { sessions } from "./sessions.ts";
import { events } from "./events.ts";
import { sessionEvents } from "./session-events.ts";
import { storageUnits } from "./storage-units.ts";
import { storageRecords } from "./storage-records.ts";
import { sessionProjcacheRows } from "./session-projcache-rows.ts";
import { eventUsage } from "./event-usage.ts";
import { sessionUsage } from "./session-usage.ts";
import { sessionCounts } from "./session-counts.ts";

export { persistenceState };
export { sessions };
export { events };
export { sessionEvents };
export { storageUnits };
export { storageRecords };
export { sessionProjcacheRows };
export { eventUsage };
export { sessionUsage };
export { sessionCounts };

// 库结构的唯一事实来源：一份定义两方言共用（列类型由 rdbkit 的方言渲染，不另抄一份 PG 清单）。
export const sqliteTableDefs = [
  persistenceState,
  sessions,
  events,
  sessionEvents,
  storageUnits,
  storageRecords,
  sessionProjcacheRows,
  eventUsage,
  sessionUsage,
  sessionCounts,
] as const;
