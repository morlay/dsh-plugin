import { persistenceState } from "./persistence-state.ts";
import { schemaMeta } from "./schema-meta.ts";
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
export { schemaMeta };
export { sessions };
export { events };
export { sessionEvents };
export { storageUnits };
export { storageRecords };
export { sessionProjcacheRows };
export { eventUsage };
export { sessionUsage };
export { sessionCounts };

export const sqliteTableDefs = [
  persistenceState,
  schemaMeta,
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

export const postgresTableDefs = [
  persistenceState,
  schemaMeta,
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
