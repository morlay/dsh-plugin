import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { PgAsyncDatabase, PgAsyncTransaction } from "drizzle-orm/pg-core";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionStorageMetadata } from "@deepseek-ai/dsh-session-persistence";
import {
  type Backend,
  type BackendTx,
  type EventInsert,
  type EventRow,
  type SessionCountBucket,
  type SessionListRowsPage,
  type SessionListRowsQuery,
  type SessionRow,
  type SessionUsageBucket,
} from "./backend.ts";
import { toPostgresSchema } from "./adapters/index.ts";
import { postgresTableDefs } from "./entities/index.ts";
import { sessionConflictRow, sessionInsertRow, titleOfEventData } from "./log.ts";
import type { EventUsageRow } from "./log.ts";
import { createStorageRepository } from "./storage-takeover/repository.ts";
import type { StorageRepository } from "./storage-takeover/types.ts";
import {
  COUNTED_EVENT_TYPES,
  addActivityTotals,
  addTokenTotals,
  addTotals,
  emptyTotals,
  localDayKey,
} from "./usage.ts";
import type { UsageActivityTotals, UsageAggregate, UsageTokenTotals } from "./usage.ts";

const postgresMigrationsDir = fileURLToPath(new URL("../drizzle/postgres/", import.meta.url));

const pgWriteQueues = new Map<string, Promise<void>>();

/** 按介质（连接串 + schema）串行化写事务，与 SQLite 侧的 `enqueueSqliteTx` 同形。 */
function enqueuePgWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const tail = pgWriteQueues.get(key) ?? Promise.resolve();
  const run = tail.then(fn);
  pgWriteQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** pg 的 text 列窄化：非字符串（含 null）都不当作文本。 */
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** pg 的 count/sum 回落成字符串：统一转成有限数。 */
function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** SQL 的缺失求和是 NULL：没有 usage 字段的行使该字段计 0。 */
function tokenTotalsOf(row: Record<string, unknown>): UsageTokenTotals {
  return {
    inputTokens: numeric(row["input_tokens"]),
    outputTokens: numeric(row["output_tokens"]),
    cacheReadTokens: numeric(row["cache_read_tokens"]),
    reasoningTokens: numeric(row["reasoning_tokens"]),
    totalTokens: numeric(row["total_tokens"]),
  };
}

function emptyActivity(): UsageActivityTotals {
  return { turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };
}

/** `t_session_counts` 的四项计数折成活动计数（pg 的 sum 回落成字符串）。 */
function activityTotalsOf(row: Record<string, unknown>): UsageActivityTotals {
  return {
    turns: numeric(row["turns"]),
    steps: numeric(row["steps"]),
    userInputs: numeric(row["user_inputs"]),
    toolCalls: numeric(row["tool_calls"]),
  };
}

/** `IN (...)` 用的类型字面量（与 `COUNTED_EVENT_TYPES` 同源）。 */
const COUNTED_EVENT_TYPE_SQL = COUNTED_EVENT_TYPES.map((type) => `'${type}'`).join(", ");

export interface PostgresBackendOptions {
  identityBase: string;

  schema?: string;

  close: () => Promise<void>;
}

export class PostgresBackend implements Backend {
  readonly kind = "postgres" as const;
  storeIdentity!: string;

  private readonly tables: Record<string, any>;

  readonly storage: StorageRepository;

  private readonly opened: Promise<void>;
  private resolveOpened!: () => void;
  private rejectOpened!: (error: unknown) => void;

  private txOverride: unknown;

  constructor(
    private readonly db: NodePgDatabase,
    private readonly options: PostgresBackendOptions,
  ) {
    this.tables = toPostgresSchema(postgresTableDefs, this.options.schema ?? "public");
    this.opened = new Promise<void>((resolve, reject) => {
      this.resolveOpened = resolve;
      this.rejectOpened = reject;
    });

    this.opened.catch(() => {});
    // 写事务按介质串行（与 SQLite 侧的 enqueueSqliteTx 同形）：并发 `writeAtomically`
    // 会互相覆盖实例级的 `txOverride`，让先开始的事务的语句落到别人的事务（一次失败
    // 会把另一个成功事务一起拖垮），或退化成 autocommit。介质身份用 `identityBase`
    // （宿主 + 库 + schema）——同一进程内多实例连同一库时也共用同一条队列。
    const writeQueueKey = options.identityBase;
    this.storage = createStorageRepository({
      db: () => this.opened.then(() => this.txOverride ?? this.db),

      writeAtomically: (fn) =>
        enqueuePgWrite(writeQueueKey, () =>
          this.db.transaction(
            async (tx) => {
              const previous = this.txOverride;
              this.txOverride = tx;
              try {
                return await fn();
              } finally {
                this.txOverride = previous;
              }
            },
            { isolationLevel: "serializable" },
          ),
        ),
      tables: this.tables,
    });
  }

  async open(): Promise<void> {
    try {
      await this.doOpen();
      this.resolveOpened();
    } catch (error: unknown) {
      this.rejectOpened(error);
      throw error;
    }
  }

  private async doOpen(): Promise<void> {
    const schema = this.options.schema ?? "public";

    const qualifiedMeta = schema === "public" ? "t_schema_meta" : `"${schema}".t_schema_meta`;
    const probe = (await this.db.execute(
      sql`SELECT to_regclass(${qualifiedMeta}) IS NOT NULL AS exists`,
    )) as unknown as { rows: { exists: boolean }[] };
    const metaExists = probe.rows[0]?.exists === true;
    if (metaExists) {
      const version = await this.readMeta(this.db, "schema_version");
      if (version === "2") {
        await this.baselineV2();
      }
    }
    await migrate(this.db, { migrationsFolder: postgresMigrationsDir });
    await this.backfillUsageTables();
    const storeId = await this.db.transaction(async (tx) => {
      await tx
        .insert(this.tables["t_persistence_state"])
        .values({ fSingleton: 1, fStoreId: randomUUID() })
        .onConflictDoNothing()
        .execute();
      const store = await tx
        .select({ fStoreId: this.tables["t_persistence_state"].fStoreId })
        .from(this.tables["t_persistence_state"])
        .where(eq(this.tables["t_persistence_state"].fSingleton, 1))
        .execute();
      const id = store[0]?.fStoreId;
      if (id === undefined || id.length === 0) {
        throw new Error("session database has no valid store identity");
      }
      return id;
    });
    this.storeIdentity = `${this.options.identityBase}:store:${storeId}`;
  }

  private async baselineV2(): Promise<void> {
    const dir = (await readdir(postgresMigrationsDir)).find((name) => name.endsWith("_v2_initial"));
    if (dir === undefined) throw new Error("missing v2 baseline migration in drizzle/postgres");
    await this.db.execute(sql`
      CREATE SCHEMA IF NOT EXISTS drizzle
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint,
        name text,
        applied_at timestamp with time zone DEFAULT now()
      )
    `);
    await this.db.execute(
      sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at, name) VALUES ('baseline', 0, ${dir})`,
    );
  }

  async close(): Promise<void> {
    await this.options.close();
  }

  async getSession(id: SessionId): Promise<SessionRow | undefined> {
    return (
      await this.db
        .select()
        .from(this.tables["t_sessions"])
        .where(eq(this.tables["t_sessions"].fSessionId, id))
        .execute()
    )[0] as SessionRow | undefined;
  }

  async getEventRows(id: SessionId, fromSequence?: number): Promise<EventRow[]> {
    const scoped =
      fromSequence === undefined
        ? this.eventRows(this.db).where(eq(this.tables["t_session_events"].fSessionId, id))
        : this.eventRows(this.db).where(
            and(
              eq(this.tables["t_session_events"].fSessionId, id),
              gte(this.tables["t_session_events"].fSequence, fromSequence),
            ),
          );
    return scoped
      .orderBy(this.tables["t_session_events"].fSequence)
      .execute() as unknown as EventRow[];
  }

  // 只取类型：rewind 的边界 / 窗口探测不该把整个事件 JSON（f_data）拖回来。
  async getEventTypeAt(id: SessionId, sequence: number): Promise<string | undefined> {
    const table = this.tables["t_session_events"];
    const rows = (await this.db
      .select({ fType: this.tables["t_events"].fType })
      .from(table)
      .innerJoin(this.tables["t_events"], eq(table.fEventId, this.tables["t_events"].fEventId))
      .where(and(eq(table.fSessionId, id), eq(table.fSequence, sequence)))
      .limit(1)
      .execute()) as Array<{ fType?: string }>;
    return rows[0]?.fType;
  }

  async getEventTypesBefore(
    id: SessionId,
    beforeSequence: number,
    limit: number,
  ): Promise<Array<Pick<EventRow, "fSequence" | "fType">>> {
    const table = this.tables["t_session_events"];
    return (await this.db
      .select({ fSequence: table.fSequence, fType: this.tables["t_events"].fType })
      .from(table)
      .innerJoin(this.tables["t_events"], eq(table.fEventId, this.tables["t_events"].fEventId))
      .where(and(eq(table.fSessionId, id), lt(table.fSequence, beforeSequence)))
      .orderBy(desc(table.fSequence))
      .limit(limit)
      .execute()) as unknown as Array<Pick<EventRow, "fSequence" | "fType">>;
  }

  async listSessions(): Promise<SessionRow[]> {
    return this.db.select().from(this.tables["t_sessions"]).execute() as unknown as Promise<
      SessionRow[]
    >;
  }

  async transaction<T>(fn: (tx: BackendTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(this.txFor(tx)));
  }

  private txFor(tx: PgAsyncTransaction<NodePgQueryResultHKT>): BackendTx {
    return {
      upsertSession: (storage, incarnation) => this.upsertSession(tx, storage, incarnation),
      getHead: (id) => this.getHead(tx, id),
      getSeedLength: (id) => this.getSeedLength(tx, id),
      updateSeedLength: (id, seedLength) => this.updateSeedLength(tx, id, seedLength),
      insertEvents: (events, usageRows) => this.insertEvents(tx, events, usageRows),
      insertBridges: (rows) => this.insertBridges(tx, rows),
      updateHead: (id, headEventId, headSequence) =>
        this.updateHead(tx, id, headEventId, headSequence),
      bumpRevision: (id, lastEventAt) => this.bumpRevision(tx, id, lastEventAt),
      refreshTitle: (id) => this.refreshTitle(tx, id),
      deleteBridgeTail: (id, fromSequence) => this.deleteBridgeTail(tx, id, fromSequence),
      getPrevBridge: (id, sequence) => this.getPrevBridge(tx, id, sequence),
      deleteSession: (id) => this.deleteSession(tx, id),
      deleteSessions: (ids) => this.deleteSessions(tx, ids),
    };
  }

  private async readMeta(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    key: string,
  ): Promise<string | undefined> {
    const rows = await exec
      .select({ fValue: this.tables["t_schema_meta"].fValue })
      .from(this.tables["t_schema_meta"])
      .where(eq(this.tables["t_schema_meta"].fKey, key))
      .execute();
    return rows[0]?.fValue;
  }

  private async upsertSession(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    storage: SessionStorageMetadata,
    incarnation: string,
  ): Promise<void> {
    await exec
      .insert(this.tables["t_sessions"])
      .values(sessionInsertRow(storage, incarnation))
      .onConflictDoUpdate({
        target: this.tables["t_sessions"].fSessionId,
        set: sessionConflictRow(storage),
      })
      .execute();
  }

  private async getHead(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
  ): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">> {
    const head = (
      await exec
        .select({
          fHeadEventId: this.tables["t_sessions"].fHeadEventId,
          fHeadSequence: this.tables["t_sessions"].fHeadSequence,
        })
        .from(this.tables["t_sessions"])
        .where(eq(this.tables["t_sessions"].fSessionId, id))
        .execute()
    )[0] as Pick<SessionRow, "fHeadEventId" | "fHeadSequence"> | undefined;

    if (head === undefined) throw new Error(`session "${id}" has no materialized row`);
    return head;
  }

  private async getSeedLength(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
  ): Promise<number | null> {
    const row = (
      await exec
        .select({ fSeedLength: this.tables["t_sessions"].fSeedLength })
        .from(this.tables["t_sessions"])
        .where(eq(this.tables["t_sessions"].fSessionId, id))
        .execute()
    )[0] as { fSeedLength: number | null } | undefined;

    if (row === undefined) throw new Error(`session "${id}" has no materialized row`);
    return row.fSeedLength;
  }

  private async updateSeedLength(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
    seedLength: number,
  ): Promise<void> {
    await exec
      .update(this.tables["t_sessions"])
      .set({ fSeedLength: seedLength })
      .where(eq(this.tables["t_sessions"].fSessionId, id))
      .execute();
  }

  private static readonly INSERT_BATCH_ROWS = 1000;

  private async insertEvents(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    events: EventInsert[],
    usageRows: readonly EventUsageRow[],
  ): Promise<void> {
    if (events.length === 0) return;
    for (let i = 0; i < events.length; i += PostgresBackend.INSERT_BATCH_ROWS) {
      await exec
        .insert(this.tables["t_events"])
        .values(
          events.slice(i, i + PostgresBackend.INSERT_BATCH_ROWS).map((event) => ({ ...event })),
        )
        .execute();
    }
    // 用量行顺带落 t_event_usage（本地日与引用标记已由写路径物化）：统计不再解析事件 JSON、
    // 也不回连事件表。
    if (usageRows.length > 0) {
      for (let i = 0; i < usageRows.length; i += PostgresBackend.INSERT_BATCH_ROWS) {
        await exec
          .insert(this.tables["t_event_usage"])
          .values(
            usageRows.slice(i, i + PostgresBackend.INSERT_BATCH_ROWS).map((row) => ({ ...row })),
          )
          .onConflictDoNothing()
          .execute();
      }
    }
  }

  private async insertBridges(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    rows: Array<{
      fSessionId: SessionId;
      fEventId: string;
      fSequence: number;
      fSurfaceOp: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += PostgresBackend.INSERT_BATCH_ROWS) {
      await exec
        .insert(this.tables["t_session_events"])
        .values(rows.slice(i, i + PostgresBackend.INSERT_BATCH_ROWS).map((row) => ({ ...row })))
        .execute();
    }
  }

  private async updateHead(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
    headEventId: string,
    headSequence: number,
  ): Promise<void> {
    await exec
      .update(this.tables["t_sessions"])
      .set({ fHeadEventId: headEventId, fHeadSequence: headSequence })
      .where(eq(this.tables["t_sessions"].fSessionId, id))
      .execute();
  }

  private async bumpRevision(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
    lastEventAt?: number,
  ): Promise<void> {
    const sessions = this.tables["t_sessions"];
    await exec
      .update(sessions)
      .set({
        fRevision: sql`${sessions.fRevision} + 1`,
        ...(lastEventAt === undefined
          ? {}
          : { fLastEventAt: sql`GREATEST(COALESCE(${sessions.fLastEventAt}, 0), ${lastEventAt})` }),
      })
      .where(eq(sessions.fSessionId, id))
      .execute();
  }

  private async refreshTitle(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
  ): Promise<void> {
    const bridges = this.tables["t_session_events"];
    const entities = this.tables["t_events"];
    const row = (
      await exec
        .select({ fSequence: bridges.fSequence, fData: entities.fData })
        .from(bridges)
        .innerJoin(entities, eq(entities.fEventId, bridges.fEventId))
        .where(and(eq(bridges.fSessionId, id), eq(entities.fType, "session/title")))
        .orderBy(desc(bridges.fSequence))
        .limit(1)
        .execute()
    )[0] as { fSequence: number; fData: string } | undefined;
    const title = row === undefined ? undefined : titleOfEventData(row.fData);
    await exec
      .update(this.tables["t_sessions"])
      .set({ fTitle: title ?? null, fTitleSeq: title === undefined ? null : row!.fSequence })
      .where(eq(this.tables["t_sessions"].fSessionId, id))
      .execute();
  }

  private async deleteBridgeTail(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
    fromSequence: number,
  ): Promise<void> {
    await exec
      .delete(this.tables["t_session_events"])
      .where(
        and(
          eq(this.tables["t_session_events"].fSessionId, id),
          gte(this.tables["t_session_events"].fSequence, fromSequence),
        ),
      )
      .execute();
  }

  private async deleteSession(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
  ): Promise<void> {
    await exec
      .delete(this.tables["t_session_events"])
      .where(eq(this.tables["t_session_events"].fSessionId, id))
      .execute();
    await exec
      .delete(this.tables["t_workspace_sessions"])
      .where(eq(this.tables["t_workspace_sessions"].fSessionId, id))
      .execute();
    await exec
      .delete(this.tables["t_session_projcache_row"])
      .where(eq(this.tables["t_session_projcache_row"].fSessionId, id))
      .execute();
    await exec
      .delete(this.tables["t_sessions"])
      .where(eq(this.tables["t_sessions"].fSessionId, id))
      .execute();
  }

  /** 事件行可能被多个会话共享（fork 派生），所以孤儿只能在全库范围内判定。 */
  async collectOrphans(): Promise<number> {
    const tEvents = this.tables["t_events"];
    const tEventUsage = this.tables["t_event_usage"];
    const tSessionEvents = this.tables["t_session_events"];
    const result = (await this.db
      .delete(tEvents)
      .where(
        notInArray(
          tEvents.fEventId,
          this.db.select({ fEventId: tSessionEvents.fEventId }).from(tSessionEvents),
        ),
      )
      .execute()) as unknown as { rowCount?: number | null };
    // 用量行跟着事件行走：没有事件行的用量不再计入统计。
    await this.db
      .delete(tEventUsage)
      .where(
        notInArray(
          tEventUsage.fEventId,
          this.db.select({ fEventId: tEvents.fEventId }).from(tEvents),
        ),
      )
      .execute();
    return result.rowCount ?? 0;
  }

  /** 父会话被删后留下的 subagent 会话：父已不在表里，或本来就没有父。 */
  async listOrphanSubagentSessions(): Promise<SessionId[]> {
    const tSessions = this.tables["t_sessions"];
    const result = (await this.db.execute(sql`
      SELECT s.f_session_id AS id FROM ${tSessions} AS s
      WHERE s.f_origin = 'subagent'
        AND (s.f_parent_session IS NULL
             OR s.f_parent_session NOT IN (SELECT p.f_session_id FROM ${tSessions} AS p))
    `)) as unknown as { rows: Array<{ id: string }> };
    return result.rows.map((row) => row.id as SessionId);
  }

  private async deleteSessions(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    ids: SessionId[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    await exec
      .delete(this.tables["t_session_events"])
      .where(inArray(this.tables["t_session_events"].fSessionId, ids))
      .execute();
    await exec
      .delete(this.tables["t_workspace_sessions"])
      .where(inArray(this.tables["t_workspace_sessions"].fSessionId, ids))
      .execute();
    await exec
      .delete(this.tables["t_session_projcache_row"])
      .where(inArray(this.tables["t_session_projcache_row"].fSessionId, ids))
      .execute();
    const result = (await exec
      .delete(this.tables["t_sessions"])
      .where(inArray(this.tables["t_sessions"].fSessionId, ids))
      .execute()) as unknown as { rowCount?: number | null };
    return result.rowCount ?? 0;
  }

  async vacuum(): Promise<void> {
    await this.db.execute(sql`VACUUM ANALYZE`);
  }

  /** 派生统计表的回填：任一表为空即按事件表全量重算（幂等，迁移删表重建后自愈）。 */
  private async backfillUsageTables(): Promise<void> {
    // 顺序有依赖：用量行（带物化列）先落，两张会话汇总表再从它 / 事件表重算。
    await this.backfillEventUsage();
    await this.backfillSessionUsage();
    await this.backfillSessionCounts();
  }

  private async tableIsEmpty(table: string): Promise<boolean> {
    const existing = (await this.db.execute(
      sql.raw(`SELECT count(*) AS n FROM ${table}`),
    )) as unknown as { rows: Array<Record<string, unknown>> };
    return Number(existing.rows[0]?.["n"] ?? 0) === 0;
  }

  /**
   * 用量行：一条 `assistant/message` 事件行一行，物化本地日与两个归属标记。
   * 本地日按数据库会话时区渲染（部署前提是它与 host 时区一致，`localDayKey` 同口径）。
   */
  private async backfillEventUsage(): Promise<void> {
    if (!(await this.tableIsEmpty(this.qualifiedTable("t_event_usage")))) return;
    const tEventUsage = this.tables["t_event_usage"];
    const tEvents = this.tables["t_events"];
    const tSessionEvents = this.tables["t_session_events"];
    const tSessions = this.tables["t_sessions"];
    await this.db.execute(sql`
      INSERT INTO ${tEventUsage} (
        f_event_id, f_created_at, f_day, f_provider, f_model, f_referenced, f_subagent,
        f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
      SELECT e.f_event_id, e.f_created_at,
             to_char(to_timestamp(e.f_created_at / 1000.0), 'YYYY-MM-DD'),
             coalesce(e.f_data::json #>> '{data,message,source,provider}',
                      e.f_data::json #>> '{message,source,provider}'),
             coalesce(e.f_data::json #>> '{data,message,source,model}',
                      e.f_data::json #>> '{message,source,model}'),
             (EXISTS (SELECT 1 FROM ${tSessionEvents} rb
                       WHERE rb.f_event_id = e.f_event_id))::int,
             (EXISTS (SELECT 1 FROM ${tSessionEvents} sb
                        JOIN ${tSessions} ss ON ss.f_session_id = sb.f_session_id
                       WHERE sb.f_event_id = e.f_event_id AND ss.f_origin = 'subagent'))::int,
             coalesce((e.f_data::json #>> '{data,usage,inputTokens}')::integer,
                      (e.f_data::json #>> '{usage,inputTokens}')::integer, 0),
             coalesce((e.f_data::json #>> '{data,usage,outputTokens}')::integer,
                      (e.f_data::json #>> '{usage,outputTokens}')::integer, 0),
             coalesce((e.f_data::json #>> '{data,usage,cacheReadTokens}')::integer,
                      (e.f_data::json #>> '{usage,cacheReadTokens}')::integer, 0),
             coalesce((e.f_data::json #>> '{data,usage,reasoningTokens}')::integer,
                      (e.f_data::json #>> '{usage,reasoningTokens}')::integer, 0),
             coalesce((e.f_data::json #>> '{data,usage,totalTokens}')::integer,
                      (e.f_data::json #>> '{usage,totalTokens}')::integer, 0)
        FROM ${tEvents} e
       WHERE e.f_type = 'assistant/message'
         AND (e.f_data::json #> '{data,usage}' IS NOT NULL
              OR e.f_data::json #> '{usage}' IS NOT NULL)
      ON CONFLICT DO NOTHING
    `);
  }

  /** 会话 × 本地日 × 模型的 token 汇总：从桥接行 × 用量行重算（含 fork 继承前缀）。 */
  private async backfillSessionUsage(): Promise<void> {
    if (!(await this.tableIsEmpty(this.qualifiedTable("t_session_usage")))) return;
    const tSessionUsage = this.tables["t_session_usage"];
    const tSessionEvents = this.tables["t_session_events"];
    const tEventUsage = this.tables["t_event_usage"];
    await this.db.execute(sql`
      INSERT INTO ${tSessionUsage} (
        f_session_id, f_day, f_provider, f_model,
        f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
      SELECT b.f_session_id, u.f_day, coalesce(u.f_provider, ''), coalesce(u.f_model, ''),
             sum(u.f_input_tokens), sum(u.f_output_tokens), sum(u.f_cache_read_tokens),
             sum(u.f_reasoning_tokens), sum(u.f_total_tokens)
        FROM ${tSessionEvents} b
        JOIN ${tEventUsage} u ON u.f_event_id = b.f_event_id
       GROUP BY 1, 2, 3, 4
      ON CONFLICT DO NOTHING
    `);
  }

  /** 会话 × 本地日的活动计数：从桥接行 × 事件类型重算。 */
  private async backfillSessionCounts(): Promise<void> {
    if (!(await this.tableIsEmpty(this.qualifiedTable("t_session_counts")))) return;
    const tSessionCounts = this.tables["t_session_counts"];
    const tSessionEvents = this.tables["t_session_events"];
    const tEvents = this.tables["t_events"];
    await this.db.execute(sql`
      INSERT INTO ${tSessionCounts} (
        f_session_id, f_day, f_turns, f_steps, f_user_inputs, f_tool_calls)
      SELECT b.f_session_id,
             to_char(to_timestamp(e.f_created_at / 1000.0), 'YYYY-MM-DD'),
             sum(CASE WHEN e.f_type = 'turn/start' THEN 1 ELSE 0 END),
             sum(CASE WHEN e.f_type = 'step/start' THEN 1 ELSE 0 END),
             sum(CASE WHEN e.f_type = 'user/message' THEN 1 ELSE 0 END),
             sum(CASE WHEN e.f_type = 'tool/call' THEN 1 ELSE 0 END)
        FROM ${tSessionEvents} b
        JOIN ${tEvents} e ON e.f_event_id = b.f_event_id
       WHERE e.f_type IN (${sql.raw(COUNTED_EVENT_TYPE_SQL)})
       GROUP BY 1, 2
      ON CONFLICT DO NOTHING
    `);
  }

  /** 用量聚合：与 SQLite 侧同形，读 `t_event_usage`，数值列回来是字符串。 */
  async listSessionRows(query: SessionListRowsQuery = {}): Promise<SessionListRowsPage> {
    const needle = query.query?.trim().toLowerCase() ?? "";
    const like = `%${needle}%`;
    const includeSubagents = query.includeSubagents === true;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const tSessions = this.tables["t_sessions"];
    const tWorkspaces = this.tables["t_workspaces"];
    const tWorkspaceSessions = this.tables["t_workspace_sessions"];
    // 归属可能有多行（一个会话可在多个工作区）：取 position 最小的那条，避免放大结果行数。
    const workspaceTitle = sql`(SELECT w.f_title FROM ${tWorkspaceSessions} b
                                     JOIN ${tWorkspaces} w ON w.f_workspace_id = b.f_workspace_id
                                    WHERE b.f_session_id = s.f_session_id
                                    ORDER BY b.f_position LIMIT 1)`;
    const where = sql`WHERE (${needle} = ''
                          OR lower(COALESCE(s.f_title, '')) LIKE ${like}
                          OR lower(COALESCE(${workspaceTitle}, '')) LIKE ${like})
                        AND (${includeSubagents} OR s.f_origin IS DISTINCT FROM 'subagent')`;
    const rows = (await this.db.execute(sql`
      SELECT s.f_session_id AS session_id,
             s.f_title AS title,
             s.f_origin AS origin,
             s.f_cwd AS cwd,
             s.f_created_at AS created_at,
             (s.f_archived_at IS NOT NULL) AS archived,
             COALESCE(s.f_last_event_at, s.f_created_at) AS updated_at,
             ${workspaceTitle} AS workspace
        FROM ${tSessions} s
        ${where}
       ORDER BY updated_at DESC, s.f_session_id
       LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    const counted = (await this.db.execute(sql`
      SELECT count(*) AS n FROM ${tSessions} s ${where}
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    return {
      items: rows.rows.map((row) => ({
        sessionId:
          typeof row["session_id"] === "string" ? row["session_id"] : String(row["session_id"]),
        title: typeof row["title"] === "string" ? row["title"] : null,
        origin: typeof row["origin"] === "string" ? row["origin"] : null,
        cwd: typeof row["cwd"] === "string" ? row["cwd"] : null,
        createdAt: numeric(row["created_at"]),
        updatedAt: numeric(row["updated_at"]),
        archived: row["archived"] === true,
        subagent: row["origin"] === "subagent",
        workspace: typeof row["workspace"] === "string" ? row["workspace"] : null,
      })),
      total: numeric(counted.rows[0]?.["n"] ?? 0),
    };
  }

  /**
   * 用量聚合：与 SQLite 侧同形——只读三张派生统计表（用量行给去重口径的总量与「天 × 模型」桶，
   * 两张会话汇总表给按会话的行），数值列回来是字符串。物化列让这里不做 `EXISTS`、不回连事件表。
   */
  async usageReport(sinceMs?: number): Promise<UsageAggregate> {
    const usageSince = sinceMs === undefined ? sql`` : sql` AND f_created_at >= ${sinceMs}`;
    const dayFilter = (column: string): ReturnType<typeof sql> =>
      sinceMs === undefined ? sql`` : sql` AND ${sql.raw(column)} >= ${localDayKey(sinceMs)}`;
    const tEventUsage = this.tables["t_event_usage"];
    const tSessionUsage = this.tables["t_session_usage"];
    const tSessionCounts = this.tables["t_session_counts"];
    const tSessions = this.tables["t_sessions"];
    const tokenColumns = (alias: string): ReturnType<typeof sql> =>
      sql.raw(`sum(${alias}.f_input_tokens) AS input_tokens,
                sum(${alias}.f_output_tokens) AS output_tokens,
                sum(${alias}.f_cache_read_tokens) AS cache_read_tokens,
                sum(${alias}.f_reasoning_tokens) AS reasoning_tokens,
                sum(${alias}.f_total_tokens) AS total_tokens`);

    const buckets = (await this.db.execute(sql`
      SELECT a.f_day AS day,
             a.f_provider AS provider,
             a.f_model AS model,
             (a.f_subagent = 1) AS subagent,
             ${tokenColumns("a")}
        FROM ${tEventUsage} a
       WHERE a.f_referenced = 1${usageSince}
       GROUP BY 1, 2, 3, 4
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    const tokenScope = (await this.db.execute(sql`
      SELECT (a.f_subagent = 1) AS subagent,
             ${tokenColumns("a")}
        FROM ${tEventUsage} a
       WHERE a.f_referenced = 1${usageSince}
       GROUP BY 1
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    const activityScope = (await this.db.execute(sql`
      SELECT (s.f_origin = 'subagent') AS subagent,
             sum(c.f_turns) AS turns,
             sum(c.f_steps) AS steps,
             sum(c.f_user_inputs) AS user_inputs,
             sum(c.f_tool_calls) AS tool_calls
        FROM ${tSessionCounts} c
        JOIN ${tSessions} s ON s.f_session_id = c.f_session_id
       WHERE EXISTS (SELECT 1 FROM ${tSessionUsage} ub WHERE ub.f_session_id = c.f_session_id)${dayFilter("c.f_day")}
       GROUP BY 1
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    const tokenSessions = (await this.db.execute(sql`
      SELECT u.f_session_id AS session_id,
             s.f_title AS title,
             (s.f_origin = 'subagent') AS subagent,
             (s.f_archived_at IS NOT NULL) AS archived,
             ${tokenColumns("u")}
        FROM ${tSessionUsage} u
        JOIN ${tSessions} s ON s.f_session_id = u.f_session_id
       WHERE 1 = 1${dayFilter("u.f_day")}
       GROUP BY u.f_session_id, s.f_title, s.f_origin, s.f_archived_at
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    const activitySessions = (await this.db.execute(sql`
      SELECT c.f_session_id AS session_id,
             sum(c.f_turns) AS turns,
             sum(c.f_steps) AS steps,
             sum(c.f_user_inputs) AS user_inputs,
             sum(c.f_tool_calls) AS tool_calls
        FROM ${tSessionCounts} c
       WHERE 1 = 1${dayFilter("c.f_day")}
       GROUP BY c.f_session_id
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    const human = emptyTotals();
    const subagent = emptyTotals();
    for (const row of tokenScope.rows) {
      addTokenTotals(row["subagent"] === true ? subagent : human, tokenTotalsOf(row));
    }
    for (const row of activityScope.rows) {
      addActivityTotals(row["subagent"] === true ? subagent : human, activityTotalsOf(row));
    }
    const totals = addTotals(addTotals(emptyTotals(), human), subagent);

    const activityBySession = new Map<string, UsageActivityTotals>();
    for (const row of activitySessions.rows) {
      activityBySession.set(String(row["session_id"]), activityTotalsOf(row));
    }
    return {
      totals,
      subagent,
      human,
      buckets: buckets.rows.map((row) => ({
        day: String(row["day"]),
        provider: text(row["provider"]),
        model: text(row["model"]),
        subagent: row["subagent"] === true,
        ...tokenTotalsOf(row),
      })),
      sessions: tokenSessions.rows.map((row) => ({
        sessionId:
          typeof row["session_id"] === "string" ? row["session_id"] : String(row["session_id"]),
        title: text(row["title"]),
        subagent: row["subagent"] === true,
        archived: row["archived"] === true,
        ...tokenTotalsOf(row),
        ...(activityBySession.get(String(row["session_id"])) ?? emptyActivity()),
      })),
    };
  }

  /** 表名限定到配置的 schema。 */
  private qualifiedTable(name: string): string {
    const schema = this.options.schema ?? "public";
    return schema === "public" ? name : `"${schema}".${name}`;
  }

  /** token 用量旁路累加：派生表 `t_session_usage`，不在写事务里（失败可丢，表可销毁重建）。 */
  async incrementSessionUsage(
    id: SessionId,
    buckets: readonly SessionUsageBucket[],
  ): Promise<void> {
    if (buckets.length === 0) return;
    const tSessionUsage = this.tables["t_session_usage"];
    for (const bucket of buckets) {
      await this.db.execute(sql`
        INSERT INTO ${tSessionUsage} (
          f_session_id, f_day, f_provider, f_model,
          f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
        VALUES (${id}, ${bucket.day}, ${bucket.provider ?? ""}, ${bucket.model ?? ""},
                ${bucket.inputTokens}, ${bucket.outputTokens}, ${bucket.cacheReadTokens},
                ${bucket.reasoningTokens}, ${bucket.totalTokens})
        ON CONFLICT (f_session_id, f_day, f_provider, f_model) DO UPDATE SET
          f_input_tokens = ${tSessionUsage}.f_input_tokens + EXCLUDED.f_input_tokens,
          f_output_tokens = ${tSessionUsage}.f_output_tokens + EXCLUDED.f_output_tokens,
          f_cache_read_tokens = ${tSessionUsage}.f_cache_read_tokens + EXCLUDED.f_cache_read_tokens,
          f_reasoning_tokens = ${tSessionUsage}.f_reasoning_tokens + EXCLUDED.f_reasoning_tokens,
          f_total_tokens = ${tSessionUsage}.f_total_tokens + EXCLUDED.f_total_tokens
      `);
    }
  }

  /** 活动计数旁路累加：派生表 `t_session_counts`，同上（四项计数一次落）。 */
  async incrementSessionCounts(
    id: SessionId,
    buckets: readonly SessionCountBucket[],
  ): Promise<void> {
    if (buckets.length === 0) return;
    const tSessionCounts = this.tables["t_session_counts"];
    for (const bucket of buckets) {
      await this.db.execute(sql`
        INSERT INTO ${tSessionCounts} (
          f_session_id, f_day, f_turns, f_steps, f_user_inputs, f_tool_calls)
        VALUES (${id}, ${bucket.day}, ${bucket.turns}, ${bucket.steps},
                ${bucket.userInputs}, ${bucket.toolCalls})
        ON CONFLICT (f_session_id, f_day) DO UPDATE SET
          f_turns = ${tSessionCounts}.f_turns + EXCLUDED.f_turns,
          f_steps = ${tSessionCounts}.f_steps + EXCLUDED.f_steps,
          f_user_inputs = ${tSessionCounts}.f_user_inputs + EXCLUDED.f_user_inputs,
          f_tool_calls = ${tSessionCounts}.f_tool_calls + EXCLUDED.f_tool_calls
      `);
    }
  }

  /** 按会话重算两张汇总表（rewind / fork 之后）：先删该会话的行，再从事件表重算。 */
  async rebuildSessionStats(id: SessionId): Promise<void> {
    const tSessionUsage = this.tables["t_session_usage"];
    const tSessionCounts = this.tables["t_session_counts"];
    const tSessionEvents = this.tables["t_session_events"];
    const tEventUsage = this.tables["t_event_usage"];
    const tEvents = this.tables["t_events"];
    await this.db.execute(sql`DELETE FROM ${tSessionUsage} WHERE f_session_id = ${id}`);
    await this.db.execute(sql`
      INSERT INTO ${tSessionUsage} (
        f_session_id, f_day, f_provider, f_model,
        f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens)
      SELECT b.f_session_id, u.f_day, coalesce(u.f_provider, ''), coalesce(u.f_model, ''),
             sum(u.f_input_tokens), sum(u.f_output_tokens), sum(u.f_cache_read_tokens),
             sum(u.f_reasoning_tokens), sum(u.f_total_tokens)
        FROM ${tSessionEvents} b
        JOIN ${tEventUsage} u ON u.f_event_id = b.f_event_id
       WHERE b.f_session_id = ${id}
       GROUP BY 1, 2, 3, 4
    `);
    await this.db.execute(sql`DELETE FROM ${tSessionCounts} WHERE f_session_id = ${id}`);
    await this.db.execute(sql`
      INSERT INTO ${tSessionCounts} (
        f_session_id, f_day, f_turns, f_steps, f_user_inputs, f_tool_calls)
      SELECT b.f_session_id,
             to_char(to_timestamp(e.f_created_at / 1000.0), 'YYYY-MM-DD'),
             sum(CASE WHEN e.f_type = 'turn/start' THEN 1 ELSE 0 END),
             sum(CASE WHEN e.f_type = 'step/start' THEN 1 ELSE 0 END),
             sum(CASE WHEN e.f_type = 'user/message' THEN 1 ELSE 0 END),
             sum(CASE WHEN e.f_type = 'tool/call' THEN 1 ELSE 0 END)
        FROM ${tSessionEvents} b
        JOIN ${tEvents} e ON e.f_event_id = b.f_event_id
       WHERE b.f_session_id = ${id} AND e.f_type IN (${sql.raw(COUNTED_EVENT_TYPE_SQL)})
       GROUP BY 1, 2
    `);
  }

  /** 全量重算用量行的引用标记（rewind / fork / 会话删除之后）。 */
  async refreshEventUsageFlags(): Promise<void> {
    const tEventUsage = this.tables["t_event_usage"];
    const tSessionEvents = this.tables["t_session_events"];
    const tSessions = this.tables["t_sessions"];
    await this.db.execute(sql`
      UPDATE ${tEventUsage} SET
        f_referenced = (EXISTS (SELECT 1 FROM ${tSessionEvents} rb
                                 WHERE rb.f_event_id = ${tEventUsage}.f_event_id))::int,
        f_subagent = (EXISTS (SELECT 1 FROM ${tSessionEvents} sb
                                JOIN ${tSessions} ss ON ss.f_session_id = sb.f_session_id
                               WHERE sb.f_event_id = ${tEventUsage}.f_event_id
                                 AND ss.f_origin = 'subagent'))::int
    `);
  }

  async deleteSessionStats(id: SessionId): Promise<void> {
    await this.db.execute(
      sql`DELETE FROM ${this.tables["t_session_usage"]} WHERE f_session_id = ${id}`,
    );
    await this.db.execute(
      sql`DELETE FROM ${this.tables["t_session_counts"]} WHERE f_session_id = ${id}`,
    );
  }

  private async getPrevBridge(
    exec: PgAsyncDatabase<NodePgQueryResultHKT>,
    id: SessionId,
    sequence: number,
  ): Promise<{ fEventId: string; fSequence: number } | undefined> {
    return (
      await exec
        .select({
          fEventId: this.tables["t_session_events"].fEventId,
          fSequence: this.tables["t_session_events"].fSequence,
        })
        .from(this.tables["t_session_events"])
        .where(
          and(
            eq(this.tables["t_session_events"].fSessionId, id),
            eq(this.tables["t_session_events"].fSequence, sequence),
          ),
        )
        .execute()
    )[0] as { fEventId: string; fSequence: number } | undefined;
  }

  private eventRows(exec: PgAsyncDatabase<NodePgQueryResultHKT>) {
    return exec
      .select({
        fEventId: this.tables["t_session_events"].fEventId,
        fSequence: this.tables["t_session_events"].fSequence,
        fType: this.tables["t_events"].fType,
        fKind: this.tables["t_events"].fKind,
        fRole: this.tables["t_events"].fRole,
        fName: this.tables["t_events"].fName,
        fActionId: this.tables["t_events"].fActionId,
        fCreatedAt: this.tables["t_events"].fCreatedAt,
        fData: this.tables["t_events"].fData,
        fSurfaceOp: this.tables["t_session_events"].fSurfaceOp,
      })
      .from(this.tables["t_session_events"])
      .innerJoin(
        this.tables["t_events"],
        eq(this.tables["t_session_events"].fEventId, this.tables["t_events"].fEventId),
      );
  }
}
