import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { and, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionStorageMetadata } from "@deepseek-ai/dsh-session-persistence";
import {
  type Backend,
  type BackendTx,
  type EventInsert,
  type EventRow,
  type SessionCountBucket,
  type SessionListRowRecord,
  type SessionListRowsPage,
  type SessionListRowsQuery,
  type SessionRow,
  type SessionUsageBucket,
} from "./backend.ts";
import { sessionConflictRow, sessionInsertRow, titleOfEventData } from "./log.ts";
import type { EventUsageRow } from "./log.ts";
import {
  COUNTED_EVENT_TYPES,
  addActivityTotals,
  addTokenTotals,
  addTotals,
  emptyTotals,
  localDayKey,
} from "./usage.ts";
import type { UsageActivityTotals, UsageAggregate, UsageTokenTotals } from "./usage.ts";
import {
  DEFAULT_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
  tEventUsage,
  tEvents,
  tPersistenceState,
  tSessionEvents,
  tSessionProjcacheRows,
  tSessions,
  tStorageUnits,
  tWorkspaceSessions,
  tWorkspaceState,
  tWorkspaces,
  type JournalMode,
} from "./schema.ts";
import { createStorageRepository } from "./storage-takeover/repository.ts";
import type { StorageRepository } from "./storage-takeover/types.ts";

type SqliteDb = NodeSQLiteDatabase & { $client: DatabaseSync };

/** 用量聚合的原始行（列名是 SQL 别名）。 */
interface RawBucketRow {
  day: string;
  provider: string | null;
  model: string | null;
  subagent: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
}

/** 「是否子代理」两组的 token 合计行。 */
interface RawScopeRow extends RawBucketRow {}

/** 按会话的行：token 一条查询、活动一条查询，按 session_id 合并。 */
interface RawSessionTokenRow extends RawBucketRow {
  session_id: string;
  title: string | null;
  archived: number;
}

/** `t_session_counts` 的原始行（四项计数，列名是 SQL 别名）。 */
interface RawCountRow {
  turns: number | null;
  steps: number | null;
  user_inputs: number | null;
  tool_calls: number | null;
}

/** 按会话的活动计数行。 */
interface RawSessionCountRow extends RawCountRow {
  session_id: string;
}

/** 活动总览行：是否子代理 + 四项计数。 */
interface RawActivityScopeRow extends RawCountRow {
  subagent: number | null;
}

/** 用量行的「被引用」物化表达式（`%EVENT%` 换成事件 id 列）。 */
const EVENT_REFERENCED_SQL = `EXISTS (SELECT 1 FROM t_session_events rb
                                       WHERE rb.f_event_id = %EVENT%)`;

/** 用量行的「被 subagent 会话引用」物化表达式（`%EVENT%` 换成事件 id 列）。 */
const EVENT_SUBAGENT_SQL = `EXISTS (SELECT 1 FROM t_session_events sb
                                     JOIN t_sessions ss ON ss.f_session_id = sb.f_session_id
                                    WHERE sb.f_event_id = %EVENT% AND ss.f_origin = 'subagent')`;

/** `IN (...)` 用的类型字面量（与 `COUNTED_EVENT_TYPES` 同源）。 */
const COUNTED_EVENT_TYPE_SQL = COUNTED_EVENT_TYPES.map((type) => `'${type}'`).join(", ");

function withEvent(expression: string, column: string): string {
  return expression.replace("%EVENT%", column);
}

/**
 * 派生统计表的回填：任一表为空即按事件表全量重算（幂等；迁移删表重建后、手动清空后都靠它自愈）。
 * 顺序有依赖：用量行（带物化列）先落，两张会话汇总表再从它 / 事件表重算。
 */
function backfillUsageTables(db: DatabaseSync): void {
  backfillEventUsage(db);
  backfillSessionUsage(db);
  backfillSessionCounts(db);
}

function tableIsEmpty(db: DatabaseSync, table: string): boolean {
  const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
  return row.n === 0;
}

/** 用量行：一条 `assistant/message` 事件行一行，物化本地日与两个归属标记。 */
function backfillEventUsage(db: DatabaseSync): void {
  if (!tableIsEmpty(db, "t_event_usage")) return;
  db.exec(`INSERT OR IGNORE INTO t_event_usage (
      f_event_id, f_created_at, f_day, f_provider, f_model, f_referenced, f_subagent,
      f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
    SELECT e.f_event_id, e.f_created_at,
           date(e.f_created_at / 1000, 'unixepoch', 'localtime'),
           coalesce(json_extract(e.f_data, '$.data.message.source.provider'),
                    json_extract(e.f_data, '$.message.source.provider')),
           coalesce(json_extract(e.f_data, '$.data.message.source.model'),
                    json_extract(e.f_data, '$.message.source.model')),
           ${withEvent(EVENT_REFERENCED_SQL, "e.f_event_id")},
           ${withEvent(EVENT_SUBAGENT_SQL, "e.f_event_id")},
           coalesce(json_extract(e.f_data, '$.data.usage.inputTokens'),
                    json_extract(e.f_data, '$.usage.inputTokens'), 0),
           coalesce(json_extract(e.f_data, '$.data.usage.outputTokens'),
                    json_extract(e.f_data, '$.usage.outputTokens'), 0),
           coalesce(json_extract(e.f_data, '$.data.usage.cacheReadTokens'),
                    json_extract(e.f_data, '$.usage.cacheReadTokens'), 0),
           coalesce(json_extract(e.f_data, '$.data.usage.reasoningTokens'),
                    json_extract(e.f_data, '$.usage.reasoningTokens'), 0),
           coalesce(json_extract(e.f_data, '$.data.usage.totalTokens'),
                    json_extract(e.f_data, '$.usage.totalTokens'), 0)
      FROM t_events e
     WHERE e.f_type = 'assistant/message'
       AND (json_extract(e.f_data, '$.data.usage') IS NOT NULL
            OR json_extract(e.f_data, '$.usage') IS NOT NULL)`);
}

/** 会话 × 本地日 × 模型的 token 汇总：从桥接行 × 用量行重算（含 fork 继承前缀）。 */
function backfillSessionUsage(db: DatabaseSync): void {
  if (!tableIsEmpty(db, "t_session_usage")) return;
  db.exec(`INSERT OR IGNORE INTO t_session_usage (
      f_session_id, f_day, f_provider, f_model,
      f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
    SELECT b.f_session_id, u.f_day, coalesce(u.f_provider, ''), coalesce(u.f_model, ''),
           sum(u.f_input_tokens), sum(u.f_output_tokens), sum(u.f_cache_read_tokens),
           sum(u.f_reasoning_tokens), sum(u.f_total_tokens)
      FROM t_session_events b
      JOIN t_event_usage u ON u.f_event_id = b.f_event_id
     GROUP BY b.f_session_id, u.f_day, coalesce(u.f_provider, ''), coalesce(u.f_model, '')`);
}

/** 会话 × 本地日的活动计数：从桥接行 × 事件类型重算。 */
function backfillSessionCounts(db: DatabaseSync): void {
  if (!tableIsEmpty(db, "t_session_counts")) return;
  db.exec(`INSERT OR IGNORE INTO t_session_counts (
      f_session_id, f_day, f_turns, f_steps, f_user_inputs, f_tool_calls)
    SELECT b.f_session_id,
           date(e.f_created_at / 1000, 'unixepoch', 'localtime'),
           sum(CASE WHEN e.f_type = 'turn/start' THEN 1 ELSE 0 END),
           sum(CASE WHEN e.f_type = 'step/start' THEN 1 ELSE 0 END),
           sum(CASE WHEN e.f_type = 'user/message' THEN 1 ELSE 0 END),
           sum(CASE WHEN e.f_type = 'tool/call' THEN 1 ELSE 0 END)
      FROM t_session_events b
      JOIN t_events e ON e.f_event_id = b.f_event_id
     WHERE e.f_type IN (${COUNTED_EVENT_TYPE_SQL})
     GROUP BY b.f_session_id, 2`);
}

function sessionListRowOf(row: Record<string, unknown>): SessionListRowRecord {
  return {
    sessionId:
      typeof row["session_id"] === "string" ? row["session_id"] : String(row["session_id"]),
    title: typeof row["title"] === "string" ? row["title"] : null,
    origin: typeof row["origin"] === "string" ? row["origin"] : null,
    cwd: typeof row["cwd"] === "string" ? row["cwd"] : null,
    createdAt: Number(row["created_at"]),
    updatedAt: Number(row["updated_at"]),
    archived: row["archived"] === 1 || row["archived"] === true,
    subagent: row["origin"] === "subagent",
    workspace: typeof row["workspace"] === "string" ? row["workspace"] : null,
  };
}

/** SQL 的缺失求和是 NULL：没有 usage 字段的行使该字段计 0。 */
function tokenTotalsOf(row: {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
}): UsageTokenTotals {
  return {
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cacheReadTokens: row.cache_read_tokens ?? 0,
    reasoningTokens: row.reasoning_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
  };
}

/** `t_session_counts` 的原始行（列名是 SQL 别名）折成四项活动计数。 */
function activityTotalsOf(row: {
  turns: number | null;
  steps: number | null;
  user_inputs: number | null;
  tool_calls: number | null;
}): UsageActivityTotals {
  return {
    turns: row.turns ?? 0,
    steps: row.steps ?? 0,
    userInputs: row.user_inputs ?? 0,
    toolCalls: row.tool_calls ?? 0,
  };
}

/** 一行的整套指标：token 用量 + 活动计数（轮次 / 步骤 / 用户输入 / 工具调用）。 */
function emptyActivity(): UsageActivityTotals {
  return { turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };
}

/** 有 token 用量的会话：活动计数与列表都限定在这一批会话里，口径一致（读汇总表，几百行）。 */
function hasUsageSession(column: string): string {
  return `EXISTS (SELECT 1 FROM t_session_usage ub WHERE ub.f_session_id = ${column})`;
}

const sqliteMigrationsDir = fileURLToPath(new URL("../drizzle/sqlite/", import.meta.url));

const sqliteTxQueues = new Map<string, Promise<void>>();

function enqueueSqliteTx<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const tail = sqliteTxQueues.get(path) ?? Promise.resolve();
  const run = tail.then(fn);

  sqliteTxQueues.set(
    path,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function openDatabase(
  path: string,
  journalMode: JournalMode,
  busyTimeout = DEFAULT_BUSY_TIMEOUT_MS,
): Promise<DatabaseSync> {
  const db = new DatabaseSync(path);
  try {
    configureDatabase(db, path, journalMode, busyTimeout);
    const dbx = drizzle({ client: db });
    const { user_version: onDisk } = db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };

    if (onDisk === 2 && !hasMigrationsTable(db)) {
      await baselineV2(db);
    }
    migrate(dbx, { migrationsFolder: sqliteMigrationsDir });
    backfillUsageTables(db);

    dbx
      .insert(tPersistenceState)
      .values({ fSingleton: 1, fStoreId: randomUUID() })
      .onConflictDoNothing()
      .run();
    if (onDisk === 0 || onDisk === 2) {
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }

    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`);
    return db;
  } catch (error: unknown) {
    db.close();
    throw error;
  }
}

function hasMigrationsTable(db: DatabaseSync): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get() !== undefined
  );
}

async function baselineV2(db: DatabaseSync): Promise<void> {
  const dir = (await readdir(sqliteMigrationsDir)).find((name) => name.endsWith("_v2_initial"));
  if (dir === undefined) throw new Error("missing v2 baseline migration in drizzle/sqlite");
  db.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric,
      name text,
      applied_at TEXT
    )
  `);
  db.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)",
  ).run("baseline", 0, dir, new Date().toISOString());
}

function configureDatabase(
  db: DatabaseSync,
  path: string,
  journalMode: JournalMode,
  busyTimeout: number,
): void {
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
  const dbx = drizzle({ client: db });

  dbx.transaction(
    (tx) => {
      const { user_version: onDisk } = tx.get(sql`PRAGMA user_version`) as {
        user_version: number;
      };
      const { application_id: applicationId } = tx.get(sql`PRAGMA application_id`) as {
        application_id: number;
      };
      const { count: userObjectCount } = tx.get(
        sql`SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'`,
      ) as { count: number };
      if (onDisk === 0 && (applicationId !== 0 || userObjectCount > 0)) {
        throw new Error(
          `session database at "${path}" has an unversioned schema or application identity`,
        );
      }
      if (onDisk !== 0 && onDisk !== 2 && onDisk !== SCHEMA_VERSION) {
        throw new Error(
          `session database at "${path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
        );
      }
      if (onDisk >= 1 && applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID) {
        throw new Error(
          `session database at "${path}" has application id ${applicationId}, expected ${SESSION_PERSISTENCE_SQLITE_APPLICATION_ID}`,
        );
      }
      if (onDisk === 0) {
        tx.run(sql.raw(`PRAGMA application_id = ${SESSION_PERSISTENCE_SQLITE_APPLICATION_ID}`));
        tx.run(sql.raw(`PRAGMA user_version = ${SCHEMA_VERSION}`));
      }
    },
    { behavior: "immediate" },
  );
}

export interface SqliteBackendOptions {
  path: string;
  journalMode: JournalMode;
  busyTimeout: number;
}

export class SqliteBackend implements Backend {
  readonly kind = "sqlite" as const;
  storeIdentity!: string;

  readonly storage: StorageRepository;

  private dbPath = "";
  private db!: SqliteDb;
  private readonly dbReady: Promise<SqliteDb>;
  private resolveDb!: (db: SqliteDb) => void;
  private rejectDb!: (error: unknown) => void;

  constructor(private readonly options: SqliteBackendOptions) {
    this.dbReady = new Promise<SqliteDb>((resolve, reject) => {
      this.resolveDb = resolve;
      this.rejectDb = reject;
    });

    this.dbReady.catch(() => {});
    this.storage = createStorageRepository({
      db: () => this.dbReady,

      dbDirect: () => {
        if (this.db === undefined) throw new Error("sqlite session database is not open");
        return this.db;
      },
      writeAtomically: (fn) =>
        enqueueSqliteTx(this.dbPath, async () => {
          const db = await this.dbReady;
          db.$client.exec("BEGIN IMMEDIATE");
          try {
            const result = await fn();
            db.$client.exec("COMMIT");
            return result;
          } catch (error: unknown) {
            try {
              db.$client.exec("ROLLBACK");
            } catch {}
            throw error;
          }
        }),
      tables: {
        t_sessions: tSessions,
        t_storage_units: tStorageUnits,
        t_workspaces: tWorkspaces,
        t_workspace_sessions: tWorkspaceSessions,
        t_workspace_state: tWorkspaceState,
        t_session_projcache_row: tSessionProjcacheRows,
      },
    });
  }

  async open(): Promise<void> {
    try {
      await this.doOpen();
      this.resolveDb(this.db);
    } catch (error: unknown) {
      this.rejectDb(error);
      throw error;
    }
  }

  private async doOpen(): Promise<void> {
    const actual =
      this.options.path === ":memory:" ? this.options.path : resolve(this.options.path);
    this.dbPath = actual;
    if (actual !== ":memory:") {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 });
      await createDatabaseFile(actual);
    }

    await enqueueSqliteTx(actual, async () => {
      this.db = drizzle({
        client: await openDatabase(actual, this.options.journalMode, this.options.busyTimeout),
      });

      migrate(this.db, { migrationsFolder: sqliteMigrationsDir });
    });
    try {
      const row = this.db
        .select({ fStoreId: tPersistenceState.fStoreId })
        .from(tPersistenceState)
        .where(eq(tPersistenceState.fSingleton, 1))
        .get() as { fStoreId: string } | undefined;

      if (row === undefined) {
        throw new Error(`session database at "${actual}" has no store identity`);
      }
      if (row.fStoreId.length === 0) {
        throw new Error(`session database at "${actual}" has no valid store identity`);
      }
      if (actual !== ":memory:") {
        const identity = await stat(actual, { bigint: true });
        this.storeIdentity = `file:${identity.dev}:${identity.ino}:${identity.birthtimeNs}:store:${row.fStoreId}`;
      } else {
        this.storeIdentity = `memory:store:${row.fStoreId}`;
      }
    } catch (error: unknown) {
      this.db.$client.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db === undefined) return;
    this.db.$client.close();
  }

  async getSession(id: SessionId): Promise<SessionRow | undefined> {
    return this.db.select().from(tSessions).where(eq(tSessions.fSessionId, id)).get() as
      | SessionRow
      | undefined;
  }

  async getEventRows(id: SessionId, fromSequence?: number): Promise<EventRow[]> {
    const scoped =
      fromSequence === undefined
        ? this.eventRows().where(eq(tSessionEvents.fSessionId, id))
        : this.eventRows().where(
            and(eq(tSessionEvents.fSessionId, id), gte(tSessionEvents.fSequence, fromSequence)),
          );
    return scoped.orderBy(tSessionEvents.fSequence).all() as unknown as EventRow[];
  }

  // 只取类型：rewind 的边界 / 窗口探测不该把整个事件 JSON（f_data）拖回来。
  async getEventTypeAt(id: SessionId, sequence: number): Promise<string | undefined> {
    const row = this.db
      .select({ fType: tEvents.fType })
      .from(tSessionEvents)
      .innerJoin(tEvents, eq(tSessionEvents.fEventId, tEvents.fEventId))
      .where(and(eq(tSessionEvents.fSessionId, id), eq(tSessionEvents.fSequence, sequence)))
      .get() as { fType?: string } | undefined;
    return row?.fType;
  }

  async getEventTypesBefore(
    id: SessionId,
    beforeSequence: number,
    limit: number,
  ): Promise<Array<Pick<EventRow, "fSequence" | "fType">>> {
    return this.db
      .select({ fSequence: tSessionEvents.fSequence, fType: tEvents.fType })
      .from(tSessionEvents)
      .innerJoin(tEvents, eq(tSessionEvents.fEventId, tEvents.fEventId))
      .where(and(eq(tSessionEvents.fSessionId, id), lt(tSessionEvents.fSequence, beforeSequence)))
      .orderBy(desc(tSessionEvents.fSequence))
      .limit(limit)
      .all() as unknown as Array<Pick<EventRow, "fSequence" | "fType">>;
  }

  async listSessions(): Promise<SessionRow[]> {
    return this.db.select().from(tSessions).all() as SessionRow[];
  }

  async transaction<T>(fn: (tx: BackendTx) => Promise<T>): Promise<T> {
    return enqueueSqliteTx(this.dbPath, async () => {
      this.db.$client.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(this.tx);
        this.db.$client.exec("COMMIT");
        return result;
      } catch (error: unknown) {
        try {
          this.db.$client.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    });
  }

  private readonly tx: BackendTx = {
    upsertSession: (storage, incarnation) => this.upsertSession(storage, incarnation),
    getHead: (id) => this.getHead(id),
    getSeedLength: (id) => this.getSeedLength(id),
    updateSeedLength: (id, seedLength) => this.updateSeedLength(id, seedLength),
    insertEvents: (events, usageRows) => this.insertEvents(events, usageRows),
    insertBridges: (rows) => this.insertBridges(rows),
    updateHead: (id, headEventId, headSequence) => this.updateHead(id, headEventId, headSequence),
    bumpRevision: (id, lastEventAt) => this.bumpRevision(id, lastEventAt),
    refreshTitle: (id) => this.refreshTitle(id),
    deleteBridgeTail: (id, fromSequence) => this.deleteBridgeTail(id, fromSequence),
    getPrevBridge: (id, sequence) => this.getPrevBridge(id, sequence),
    deleteSession: (id) => this.deleteSession(id),
    deleteSessions: (ids) => this.deleteSessions(ids),
  };

  private async upsertSession(storage: SessionStorageMetadata, incarnation: string): Promise<void> {
    this.db
      .insert(tSessions)
      .values(sessionInsertRow(storage, incarnation))
      .onConflictDoUpdate({
        target: tSessions.fSessionId,
        set: sessionConflictRow(storage),
      })
      .run();
  }

  private async getHead(
    id: SessionId,
  ): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">> {
    const head = this.db
      .select({ fHeadEventId: tSessions.fHeadEventId, fHeadSequence: tSessions.fHeadSequence })
      .from(tSessions)
      .where(eq(tSessions.fSessionId, id))
      .get() as Pick<SessionRow, "fHeadEventId" | "fHeadSequence"> | undefined;

    if (head === undefined) throw new Error(`session "${id}" has no materialized row`);
    return head;
  }

  private async getSeedLength(id: SessionId): Promise<number | null> {
    const row = this.db
      .select({ fSeedLength: tSessions.fSeedLength })
      .from(tSessions)
      .where(eq(tSessions.fSessionId, id))
      .get() as { fSeedLength: number | null } | undefined;

    if (row === undefined) throw new Error(`session "${id}" has no materialized row`);
    return row.fSeedLength;
  }

  private async updateSeedLength(id: SessionId, seedLength: number): Promise<void> {
    this.db
      .update(tSessions)
      .set({ fSeedLength: seedLength })
      .where(eq(tSessions.fSessionId, id))
      .run();
  }

  private static readonly INSERT_BATCH_ROWS = 1000;

  private async insertEvents(
    events: EventInsert[],
    usageRows: readonly EventUsageRow[],
  ): Promise<void> {
    if (events.length === 0) return;
    for (let i = 0; i < events.length; i += SqliteBackend.INSERT_BATCH_ROWS) {
      this.db
        .insert(tEvents)
        .values(events.slice(i, i + SqliteBackend.INSERT_BATCH_ROWS).map((event) => ({ ...event })))
        .run();
    }
    // 用量行顺带落 t_event_usage（本地日与引用标记已由写路径物化）：统计不再解析事件 JSON、
    // 也不回连事件表（重复事件行忽略，fork 复用不重复记）。
    if (usageRows.length > 0) {
      this.db
        .insert(tEventUsage)
        .values(usageRows.map((row) => ({ ...row })))
        .onConflictDoNothing()
        .run();
    }
  }

  private async insertBridges(
    rows: Array<{
      fSessionId: SessionId;
      fEventId: string;
      fSequence: number;
      fSurfaceOp: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += SqliteBackend.INSERT_BATCH_ROWS) {
      this.db
        .insert(tSessionEvents)
        .values(rows.slice(i, i + SqliteBackend.INSERT_BATCH_ROWS).map((row) => ({ ...row })))
        .run();
    }
  }

  private async updateHead(
    id: SessionId,
    headEventId: string,
    headSequence: number,
  ): Promise<void> {
    this.db
      .update(tSessions)
      .set({ fHeadEventId: headEventId, fHeadSequence: headSequence })
      .where(eq(tSessions.fSessionId, id))
      .run();
  }

  private async bumpRevision(id: SessionId, lastEventAt?: number): Promise<void> {
    this.db
      .update(tSessions)
      .set({
        fRevision: sql`${tSessions.fRevision} + 1`,
        ...(lastEventAt === undefined
          ? {}
          : { fLastEventAt: sql`MAX(COALESCE(${tSessions.fLastEventAt}, 0), ${lastEventAt})` }),
      })
      .where(eq(tSessions.fSessionId, id))
      .run();
  }

  private async refreshTitle(id: SessionId): Promise<void> {
    const row = this.db
      .select({ fSequence: tSessionEvents.fSequence, fData: tEvents.fData })
      .from(tSessionEvents)
      .innerJoin(tEvents, eq(tEvents.fEventId, tSessionEvents.fEventId))
      .where(and(eq(tSessionEvents.fSessionId, id), eq(tEvents.fType, "session/title")))
      .orderBy(desc(tSessionEvents.fSequence))
      .limit(1)
      .get() as { fSequence: number; fData: string } | undefined;
    const title = row === undefined ? undefined : titleOfEventData(row.fData);
    this.db
      .update(tSessions)
      .set({ fTitle: title ?? null, fTitleSeq: title === undefined ? null : row!.fSequence })
      .where(eq(tSessions.fSessionId, id))
      .run();
  }

  private async deleteBridgeTail(id: SessionId, fromSequence: number): Promise<void> {
    this.db
      .delete(tSessionEvents)
      .where(and(eq(tSessionEvents.fSessionId, id), gte(tSessionEvents.fSequence, fromSequence)))
      .run();
  }

  private async getPrevBridge(
    id: SessionId,
    sequence: number,
  ): Promise<{ fEventId: string; fSequence: number } | undefined> {
    return this.db
      .select({ fEventId: tSessionEvents.fEventId, fSequence: tSessionEvents.fSequence })
      .from(tSessionEvents)
      .where(and(eq(tSessionEvents.fSessionId, id), eq(tSessionEvents.fSequence, sequence)))
      .get() as { fEventId: string; fSequence: number } | undefined;
  }

  private async deleteSession(id: SessionId): Promise<void> {
    this.db.delete(tSessionEvents).where(eq(tSessionEvents.fSessionId, id)).run();
    this.db.delete(tWorkspaceSessions).where(eq(tWorkspaceSessions.fSessionId, id)).run();
    this.db.delete(tSessionProjcacheRows).where(eq(tSessionProjcacheRows.fSessionId, id)).run();
    this.db.delete(tSessions).where(eq(tSessions.fSessionId, id)).run();
  }

  /** 事件行可能被多个会话共享（fork 派生），所以孤儿只能在全库范围内判定。 */
  async collectOrphans(): Promise<number> {
    const referenced = this.db.select({ fEventId: tSessionEvents.fEventId }).from(tSessionEvents);
    const info = this.db.delete(tEvents).where(notInArray(tEvents.fEventId, referenced)).run();
    // 用量行跟着事件行走：没有事件行的用量不再计入统计。
    this.db
      .delete(tEventUsage)
      .where(
        notInArray(
          tEventUsage.fEventId,
          this.db.select({ fEventId: tEvents.fEventId }).from(tEvents),
        ),
      )
      .run();
    return Number(info.changes);
  }

  /** 父会话被删后留下的 subagent 会话：父已不在表里，或本来就没有父。 */
  async listOrphanSubagentSessions(): Promise<SessionId[]> {
    const rows = this.db.$client
      .prepare(
        `SELECT f_session_id AS id FROM t_sessions
         WHERE f_origin = 'subagent'
           AND (f_parent_session IS NULL
                OR f_parent_session NOT IN (SELECT f_session_id FROM t_sessions))`,
      )
      .all() as Array<{ id: string }>;
    return rows.map((row) => row.id as SessionId);
  }

  private async deleteSessions(ids: SessionId[]): Promise<number> {
    if (ids.length === 0) return 0;
    this.db.delete(tSessionEvents).where(inArray(tSessionEvents.fSessionId, ids)).run();
    this.db.delete(tWorkspaceSessions).where(inArray(tWorkspaceSessions.fSessionId, ids)).run();
    this.db
      .delete(tSessionProjcacheRows)
      .where(inArray(tSessionProjcacheRows.fSessionId, ids))
      .run();
    const info = this.db.delete(tSessions).where(inArray(tSessions.fSessionId, ids)).run();
    return Number(info.changes);
  }

  /**
   * 用量聚合：token 用量沿 `t_event_usage` 的用量行，活动计数（轮次 / 步骤 / 用户输入 / 工具调用）
   * 沿 `t_events` 的事件类型数——两者限定在**有 token 用量的会话**里，时间范围各自按自己的
   * `f_created_at`（同一时刻写入，口径一致）。
   */
  async listSessionRows(query: SessionListRowsQuery = {}): Promise<SessionListRowsPage> {
    const needle = query.query?.trim().toLowerCase() ?? "";
    const like = `%${needle}%`;
    // 排序键用物化列：`f_last_event_at` 由写路径维护、老数据由迁移回填，没有事件的会话回落 createdAt。
    // 早先这里对每行算一次「该会话最后事件时间」的相关子查询——243 行要 4.2s，分页也救不了（排序要求
    // 全表先算出来）。
    const where = `WHERE (? = '' OR lower(COALESCE(s.f_title, '')) LIKE ? OR lower(COALESCE(w.f_title, '')) LIKE ?)
                     AND (? = 1 OR s.f_origin IS NOT 'subagent')`;
    const filterParams = [needle, like, like, query.includeSubagents === true ? 1 : 0];
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const rows = this.db.$client
      .prepare(
        `SELECT s.f_session_id AS session_id,
                s.f_title AS title,
                s.f_origin AS origin,
                s.f_cwd AS cwd,
                s.f_created_at AS created_at,
                (s.f_archived_at IS NOT NULL) AS archived,
                COALESCE(s.f_last_event_at, s.f_created_at) AS updated_at,
                w.f_title AS workspace
           FROM t_sessions s
           LEFT JOIN t_workspaces w ON w.f_workspace_id = (
                 SELECT b.f_workspace_id FROM t_workspace_sessions b
                  WHERE b.f_session_id = s.f_session_id ORDER BY b.f_position LIMIT 1)
          ${where}
          ORDER BY updated_at DESC, s.f_session_id
          LIMIT ? OFFSET ?`,
      )
      .all(...filterParams, limit, offset) as unknown as Array<Record<string, unknown>>;
    const counted = this.db.$client
      .prepare(
        `SELECT count(*) AS n
           FROM t_sessions s
           LEFT JOIN t_workspaces w ON w.f_workspace_id = (
                 SELECT b.f_workspace_id FROM t_workspace_sessions b
                  WHERE b.f_session_id = s.f_session_id ORDER BY b.f_position LIMIT 1)
          ${where}`,
      )
      .get(...filterParams) as { n: number };
    return {
      items: rows.map((row) => sessionListRowOf(row)),
      total: Number(counted.n),
    };
  }

  /**
   * 用量聚合：只读三张派生统计表——事件级用量行给去重口径的总量与「天 × 模型」桶，
   * `t_session_usage` / `t_session_counts` 给按会话的行（含 fork 继承前缀）。
   * 归属、本地日与「是否被引用」都是物化列，这里不再现算、也不回连事件表。
   * 事件级按毫秒时间戳过滤、汇总表按本地日过滤——`sinceMs` 对齐到本地零点时两者等价。
   */
  async usageReport(sinceMs?: number): Promise<UsageAggregate> {
    const usageSince = sinceMs === undefined ? "" : " AND f_created_at >= ?";
    const params = sinceMs === undefined ? [] : [sinceMs];
    const daySince = sinceMs === undefined ? "" : " AND %COL% >= ?";
    const dayParams = sinceMs === undefined ? [] : [localDayKey(sinceMs)];
    const dayFilter = (column: string): string => daySince.replace("%COL%", column);

    const buckets = this.db.$client
      .prepare(
        `SELECT f_day AS day,
                f_provider AS provider,
                f_model AS model,
                f_subagent AS subagent,
                sum(f_input_tokens) AS input_tokens,
                sum(f_output_tokens) AS output_tokens,
                sum(f_cache_read_tokens) AS cache_read_tokens,
                sum(f_reasoning_tokens) AS reasoning_tokens,
                sum(f_total_tokens) AS total_tokens
           FROM t_event_usage
          WHERE f_referenced = 1${usageSince}
          GROUP BY f_day, f_provider, f_model, f_subagent`,
      )
      .all(...params) as unknown as RawBucketRow[];
    const tokenScope = this.db.$client
      .prepare(
        `SELECT f_subagent AS subagent,
                sum(f_input_tokens) AS input_tokens,
                sum(f_output_tokens) AS output_tokens,
                sum(f_cache_read_tokens) AS cache_read_tokens,
                sum(f_reasoning_tokens) AS reasoning_tokens,
                sum(f_total_tokens) AS total_tokens
           FROM t_event_usage
          WHERE f_referenced = 1${usageSince}
          GROUP BY f_subagent`,
      )
      .all(...params) as unknown as RawScopeRow[];
    const activityScope = this.db.$client
      .prepare(
        `SELECT (s.f_origin = 'subagent') AS subagent,
                sum(c.f_turns) AS turns,
                sum(c.f_steps) AS steps,
                sum(c.f_user_inputs) AS user_inputs,
                sum(c.f_tool_calls) AS tool_calls
           FROM t_session_counts c
           JOIN t_sessions s ON s.f_session_id = c.f_session_id
          WHERE ${hasUsageSession("c.f_session_id")}${dayFilter("c.f_day")}
          GROUP BY subagent`,
      )
      .all(...dayParams) as unknown as RawActivityScopeRow[];
    const tokenSessions = this.db.$client
      .prepare(
        `SELECT u.f_session_id AS session_id,
                s.f_title AS title,
                (s.f_origin = 'subagent') AS subagent,
                (s.f_archived_at IS NOT NULL) AS archived,
                sum(u.f_input_tokens) AS input_tokens,
                sum(u.f_output_tokens) AS output_tokens,
                sum(u.f_cache_read_tokens) AS cache_read_tokens,
                sum(u.f_reasoning_tokens) AS reasoning_tokens,
                sum(u.f_total_tokens) AS total_tokens
           FROM t_session_usage u
           JOIN t_sessions s ON s.f_session_id = u.f_session_id
          WHERE 1 = 1${dayFilter("u.f_day")}
          GROUP BY u.f_session_id, s.f_title, s.f_origin, s.f_archived_at`,
      )
      .all(...dayParams) as unknown as RawSessionTokenRow[];
    const activitySessions = this.db.$client
      .prepare(
        `SELECT f_session_id AS session_id,
                sum(f_turns) AS turns,
                sum(f_steps) AS steps,
                sum(f_user_inputs) AS user_inputs,
                sum(f_tool_calls) AS tool_calls
           FROM t_session_counts
          WHERE 1 = 1${dayFilter("f_day")}
          GROUP BY f_session_id`,
      )
      .all(...dayParams) as unknown as RawSessionCountRow[];
    const human = emptyTotals();
    const subagent = emptyTotals();
    for (const row of tokenScope) {
      addTokenTotals(row.subagent === 1 ? subagent : human, tokenTotalsOf(row));
    }
    for (const row of activityScope) {
      addActivityTotals(row.subagent === 1 ? subagent : human, activityTotalsOf(row));
    }
    const totals = addTotals(addTotals(emptyTotals(), human), subagent);

    const activityBySession = new Map<string, UsageActivityTotals>();
    for (const row of activitySessions) {
      activityBySession.set(row.session_id, activityTotalsOf(row));
    }
    return {
      totals,
      subagent,
      human,
      buckets: buckets.map((row) => ({
        day: row.day,
        provider: row.provider,
        model: row.model,
        subagent: row.subagent === 1,
        ...tokenTotalsOf(row),
      })),
      sessions: tokenSessions.map((row) => ({
        sessionId: row.session_id,
        title: row.title,
        subagent: row.subagent === 1,
        archived: row.archived === 1,
        ...tokenTotalsOf(row),
        ...(activityBySession.get(row.session_id) ?? emptyActivity()),
      })),
    };
  }

  /** token 用量旁路累加：派生表 `t_session_usage`，不在写事务里（失败可丢，表可销毁重建）。 */
  async incrementSessionUsage(
    id: SessionId,
    buckets: readonly SessionUsageBucket[],
  ): Promise<void> {
    if (buckets.length === 0) return;
    const statement = this.db.$client.prepare(
      `INSERT INTO t_session_usage (f_session_id, f_day, f_provider, f_model,
          f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(f_session_id, f_day, f_provider, f_model) DO UPDATE SET
         f_input_tokens = f_input_tokens + excluded.f_input_tokens,
         f_output_tokens = f_output_tokens + excluded.f_output_tokens,
         f_cache_read_tokens = f_cache_read_tokens + excluded.f_cache_read_tokens,
         f_reasoning_tokens = f_reasoning_tokens + excluded.f_reasoning_tokens,
         f_total_tokens = f_total_tokens + excluded.f_total_tokens`,
    );
    for (const bucket of buckets) {
      statement.run(
        id,
        bucket.day,
        bucket.provider ?? "",
        bucket.model ?? "",
        bucket.inputTokens,
        bucket.outputTokens,
        bucket.cacheReadTokens,
        bucket.reasoningTokens,
        bucket.totalTokens,
      );
    }
  }

  /** 活动计数旁路累加：派生表 `t_session_counts`，同上（四项计数一次落）。 */
  async incrementSessionCounts(
    id: SessionId,
    buckets: readonly SessionCountBucket[],
  ): Promise<void> {
    if (buckets.length === 0) return;
    const statement = this.db.$client.prepare(
      `INSERT INTO t_session_counts (f_session_id, f_day, f_turns, f_steps, f_user_inputs, f_tool_calls)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(f_session_id, f_day) DO UPDATE SET
         f_turns = f_turns + excluded.f_turns,
         f_steps = f_steps + excluded.f_steps,
         f_user_inputs = f_user_inputs + excluded.f_user_inputs,
         f_tool_calls = f_tool_calls + excluded.f_tool_calls`,
    );
    for (const bucket of buckets) {
      statement.run(
        id,
        bucket.day,
        bucket.turns,
        bucket.steps,
        bucket.userInputs,
        bucket.toolCalls,
      );
    }
  }

  /** 按会话重算两张汇总表（rewind / fork 之后）：先删该会话的行，再从事件表重算。 */
  async rebuildSessionStats(id: SessionId): Promise<void> {
    this.db.$client.prepare("DELETE FROM t_session_usage WHERE f_session_id = ?").run(id);
    this.db.$client
      .prepare(
        `INSERT INTO t_session_usage (
             f_session_id, f_day, f_provider, f_model,
             f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
         SELECT b.f_session_id, u.f_day, coalesce(u.f_provider, ''), coalesce(u.f_model, ''),
                sum(u.f_input_tokens), sum(u.f_output_tokens), sum(u.f_cache_read_tokens),
                sum(u.f_reasoning_tokens), sum(u.f_total_tokens)
           FROM t_session_events b
           JOIN t_event_usage u ON u.f_event_id = b.f_event_id
          WHERE b.f_session_id = ?
          GROUP BY b.f_session_id, u.f_day, coalesce(u.f_provider, ''), coalesce(u.f_model, '')`,
      )
      .run(id);
    this.db.$client.prepare("DELETE FROM t_session_counts WHERE f_session_id = ?").run(id);
    this.db.$client
      .prepare(
        `INSERT INTO t_session_counts (
             f_session_id, f_day, f_turns, f_steps, f_user_inputs, f_tool_calls)
         SELECT b.f_session_id,
                date(e.f_created_at / 1000, 'unixepoch', 'localtime'),
                sum(CASE WHEN e.f_type = 'turn/start' THEN 1 ELSE 0 END),
                sum(CASE WHEN e.f_type = 'step/start' THEN 1 ELSE 0 END),
                sum(CASE WHEN e.f_type = 'user/message' THEN 1 ELSE 0 END),
                sum(CASE WHEN e.f_type = 'tool/call' THEN 1 ELSE 0 END)
           FROM t_session_events b
           JOIN t_events e ON e.f_event_id = b.f_event_id
          WHERE b.f_session_id = ? AND e.f_type IN (${COUNTED_EVENT_TYPE_SQL})
          GROUP BY b.f_session_id, 2`,
      )
      .run(id);
  }

  /**
   * 全量重算用量行的引用标记：rewind 截断 / fork 复用 / 会话删除都会让「引用」跨会话变化，
   * 只按本会话判定不够。低频路径，一次全表 UPDATE（3 万行量级）。
   */
  async refreshEventUsageFlags(): Promise<void> {
    const eventId = "t_event_usage.f_event_id";
    this.db.$client.exec(
      `UPDATE t_event_usage SET
         f_referenced = ${withEvent(EVENT_REFERENCED_SQL, eventId)},
         f_subagent = ${withEvent(EVENT_SUBAGENT_SQL, eventId)}`,
    );
  }

  async deleteSessionStats(id: SessionId): Promise<void> {
    this.db.$client.prepare("DELETE FROM t_session_usage WHERE f_session_id = ?").run(id);
    this.db.$client.prepare("DELETE FROM t_session_counts WHERE f_session_id = ?").run(id);
  }

  async vacuum(): Promise<void> {
    await enqueueSqliteTx(this.dbPath, async () => {
      this.db.$client.exec("VACUUM");
    });
  }

  private eventRows() {
    return this.db
      .select({
        fEventId: tSessionEvents.fEventId,
        fSequence: tSessionEvents.fSequence,
        fType: tEvents.fType,
        fKind: tEvents.fKind,
        fRole: tEvents.fRole,
        fName: tEvents.fName,
        fActionId: tEvents.fActionId,
        fCreatedAt: tEvents.fCreatedAt,
        fData: tEvents.fData,
        fSurfaceOp: tSessionEvents.fSurfaceOp,
      })
      .from(tSessionEvents)
      .innerJoin(tEvents, eq(tSessionEvents.fEventId, tEvents.fEventId));
  }
}
