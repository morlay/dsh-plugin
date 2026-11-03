import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  E,
  count,
  ensureSchema,
  openDatabase as openRdbkitDatabase,
  runMigrations,
  sum,
  type Database,
  type OperandInput,
  type Table,
  type TableDef,
} from "@morlay/rdbkit";
import type {
  Backend,
  BackendTx,
  EventRow,
  EventInsert,
  SessionCountBucket,
  SessionListRowsPage,
  SessionListRowsQuery,
  SessionRow,
  SessionUsageBucket,
} from "./backend.ts";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { COUNTED_EVENT_TYPES, type UsageAggregate } from "./usage.ts";
import {
  catalog,
  eventUsage,
  events,
  persistenceState,
  sessionCounts,
  sessionEvents,
  sessions,
  sessionUsage,
} from "./entities/index.ts";
import type { EventUsageRow } from "./log.ts";
import { sessionHeaderColumns, sessionInsertColumns, titleOfEventData } from "./log.ts";
import { sessionMigrations } from "./migrations.ts";
import {
  collectOrphans,
  deleteSessionStats,
  incrementSessionCounts,
  incrementSessionUsage,
  listSessionRows,
  readHead,
  readPrevBridge,
  readSeedLength,
  rebuildSessionStats,
  refreshEventUsageFlags,
  usageActivityScope,
  usageBuckets,
  usageSessionCounts,
  usageSessionTokens,
  usageTokenScope,
} from "./session-ops.ts";
import {
  createReadModel,
  headerChangedCondition,
  lastEventAtExpr,
  type ReadModel,
} from "./storage-takeover/read-model.ts";
import { createStorageRepository } from "./storage-takeover/repository.ts";
import type { StorageRepository } from "./storage-takeover/types.ts";
import { pruneWorkspaceDocuments } from "./storage-takeover/workspace-documents.ts";
import {
  DEFAULT_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
  type JournalMode,
} from "./version.ts";

/** 打开一个会话后端所需的配置（与 `Config` 的持久化字段一致）。 */
export type BackendConfig =
  | { type: "sqlite"; path: string; journalMode?: JournalMode; busyTimeout?: number }
  | { type: "postgres"; connectionString: string; schema?: string };

const INSERT_BATCH_ROWS = 1000;

/**
 * 写事务按介质串行：SQLite 的 `BEGIN IMMEDIATE` 并发会直接 busy，PG 的 `serializable` 并发会冲突；
 * 同一个库（进程内多个实例）共用一条队列。
 */
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const tail = writeQueues.get(key) ?? Promise.resolve();
  const run = tail.then(fn);
  writeQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * 唯一的 backend 实现：所有数据库操作都在这里（读模型 + `session-ops` + 表句柄），
 * 方言差异全部由 rdbkit 的表达式承担（本地日、JSON 提取这类），这里不出现任何 SQL 文本。
 */
export class RdbBackend implements Backend {
  readonly storage: StorageRepository;
  readonly storeIdentity: string;

  readonly #database: Database;
  readonly #readModel: ReadModel;

  constructor(options: {
    kind: "sqlite" | "postgres";
    database: Database;
    storage: StorageRepository;
    readModel: ReadModel;
    storeIdentity: string;
  }) {
    this.kind = options.kind;
    this.#database = options.database;
    this.storage = options.storage;
    this.#readModel = options.readModel;
    this.storeIdentity = options.storeIdentity;
  }

  readonly kind: "sqlite" | "postgres";

  async open(): Promise<void> {
    // 打开在 `openRdbBackend` 里完成（构造后即可用）。
  }

  async close(): Promise<void> {
    await this.#database.close();
  }

  async transaction<T>(fn: (tx: BackendTx) => Promise<T>): Promise<T> {
    return await this.#database.transaction(async (scoped) => fn(this.#txFor(scoped)));
  }

  async getSession(id: SessionRow["fSessionId"]): Promise<SessionRow | undefined> {
    return await this.#readModel.getSession(id);
  }

  async getEventRows(id: SessionRow["fSessionId"], fromSequence?: number): Promise<EventRow[]> {
    return await this.#readModel.getEventRows(id, fromSequence);
  }

  async getEventTypeAt(id: SessionRow["fSessionId"], sequence: number): Promise<string | undefined> {
    return await this.#readModel.getEventTypeAt(id, sequence);
  }

  async getEventTypesBefore(
    id: SessionRow["fSessionId"],
    beforeSequence: number,
    limit: number,
  ): Promise<Array<Pick<EventRow, "fSequence" | "fType">>> {
    return await this.#readModel.getEventTypesBefore(id, beforeSequence, limit);
  }

  async listSessions(): Promise<SessionRow[]> {
    return await this.#readModel.listSessions();
  }

  async listOrphanSubagentSessions(): Promise<SessionId[]> {
    return (await this.#readModel.listOrphanSubagentSessions()) as SessionId[];
  }

  /** 当前 head 指针（分支 / 测试读路径用；写路径在 `BackendTx` 里）。 */
  async getHead(id: SessionId): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">> {
    return await readHead(this.#database, id);
  }

  async collectOrphans(): Promise<number> {
    return await collectOrphans(this.#database);
  }

  async usageReport(sinceMs?: number): Promise<UsageAggregate> {
    const buckets = await usageBuckets(this.#database, sinceMs);
    const tokenScope = await usageTokenScope(this.#database, sinceMs);
    const activityScope = await usageActivityScope(this.#database, sinceMs);
    const tokenSessions = await usageSessionTokens(this.#database, sinceMs);
    const activitySessions = await usageSessionCounts(this.#database, sinceMs);

    const toToken = (row: Record<string, unknown>) => ({
      inputTokens: Number(row["input_tokens"] ?? 0),
      outputTokens: Number(row["output_tokens"] ?? 0),
      cacheReadTokens: Number(row["cache_read_tokens"] ?? 0),
      reasoningTokens: Number(row["reasoning_tokens"] ?? 0),
      totalTokens: Number(row["total_tokens"] ?? 0),
    });
    const toActivity = (row: Record<string, unknown>) => ({
      turns: Number(row["turns"] ?? 0),
      steps: Number(row["steps"] ?? 0),
      userInputs: Number(row["user_inputs"] ?? 0),
      toolCalls: Number(row["tool_calls"] ?? 0),
    });
    const emptyToken = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, totalTokens: 0 };
    const emptyActivity = { turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };
    const addToken = (target: ReturnType<typeof toToken>, row: Record<string, unknown>) => {
      const token = toToken(row);
      target.inputTokens += token.inputTokens;
      target.outputTokens += token.outputTokens;
      target.cacheReadTokens += token.cacheReadTokens;
      target.reasoningTokens += token.reasoningTokens;
      target.totalTokens += token.totalTokens;
    };
    const addActivity = (target: ReturnType<typeof toActivity>, row: Record<string, unknown>) => {
      const activity = toActivity(row);
      target.turns += activity.turns;
      target.steps += activity.steps;
      target.userInputs += activity.userInputs;
      target.toolCalls += activity.toolCalls;
    };
    const sum = (left: typeof emptyToken & typeof emptyActivity, right: typeof emptyToken & typeof emptyActivity) => ({
      inputTokens: left.inputTokens + right.inputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
      reasoningTokens: left.reasoningTokens + right.reasoningTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      turns: left.turns + right.turns,
      steps: left.steps + right.steps,
      userInputs: left.userInputs + right.userInputs,
      toolCalls: left.toolCalls + right.toolCalls,
    });

    const human = { ...emptyToken, ...emptyActivity };
    const subagent = { ...emptyToken, ...emptyActivity };
    for (const row of tokenScope) {
      addToken(Number(row.subagent) === 1 ? subagent : human, row);
    }
    for (const row of activityScope) {
      addActivity(Number(row["subagent"]) === 1 ? subagent : human, row);
    }
    const activityBySession = new Map<string, ReturnType<typeof toActivity>>();
    for (const row of activitySessions) {
      activityBySession.set(String(row["session_id"]), toActivity(row));
    }
    return {
      totals: sum(sum({ ...emptyToken, ...emptyActivity }, human), subagent),
      subagent,
      human,
      buckets: buckets.map((row) => ({
        day: String(row.day),
        provider: row.provider,
        model: row.model,
        subagent: Number(row.subagent) === 1,
        ...toToken(row as unknown as Record<string, unknown>),
      })),
      sessions: tokenSessions.map((row) => ({
        sessionId: String(row["session_id"]),
        title: asText(row["title"]),
        subagent: Number(row["subagent"]) === 1 || row["subagent"] === true,
        archived: Number(row["archived"]) === 1 || row["archived"] === true,
        ...toToken(row),
        ...(activityBySession.get(String(row["session_id"])) ?? emptyActivity),
      })),
    };
  }

  async listSessionRows(query?: SessionListRowsQuery): Promise<SessionListRowsPage> {
    const needle = query?.query?.trim().toLowerCase() ?? "";
    const index = await this.storage.listWorkspaceIndex();
    const titleMatches =
      needle === ""
        ? []
        : [
            ...new Set(
              index
                .filter((entry) => entry.title.toLowerCase().includes(needle))
                .flatMap((entry) => entry.sessionIds),
            ),
          ];
    const { items, total } = await listSessionRows(this.#database, {
      needle,
      titleMatches,
      includeSubagents: query?.includeSubagents === true,
      limit: query?.limit ?? 20,
      offset: query?.offset ?? 0,
    });
    const workspaceOf = new Map<string, string>();
    for (const entry of index) {
      for (const sessionId of entry.sessionIds) {
        if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, entry.title);
      }
    }
    return {
      items: items.map((row) => ({
        sessionId: String(row["session_id"]),
        title: asText(row["title"]),
        origin: asText(row["origin"]),
        cwd: asText(row["cwd"]),
        createdAt: Number(row["created_at"]),
        updatedAt: Number(row["updated_at"]),
        archived: Number(row["archived"]) === 1 || row["archived"] === true,
        subagent: row["origin"] === "subagent",
        workspace: workspaceOf.get(String(row["session_id"])) ?? null,
      })),
      total,
    };
  }

  async incrementSessionUsage(id: string, buckets: readonly SessionUsageBucket[]): Promise<void> {
    await incrementSessionUsage(this.#database, id, buckets);
  }

  async incrementSessionCounts(id: string, buckets: readonly SessionCountBucket[]): Promise<void> {
    await incrementSessionCounts(this.#database, id, buckets);
  }

  async deleteSessionStats(id: string): Promise<void> {
    await deleteSessionStats(this.#database, id);
  }

  async rebuildSessionStats(id: string): Promise<void> {
    const database = this.#database;
    const links = sessionEvents.table(database);
    const eventsTable = events.table(database);
    const usageTable = eventUsage.table(database);

    // 用量：本会话桥接行 × 用量行，按 (本地日, provider, model) 聚合。
    const usage = links
      .select({
        f_session_id: links.f_session_id,
        f_day: usageTable.f_day,
        f_provider: E.coalesce(usageTable.f_provider, ""),
        f_model: E.coalesce(usageTable.f_model, ""),
        f_input_tokens: sum("f_input_tokens", "t_event_usage"),
        f_output_tokens: sum("f_output_tokens", "t_event_usage"),
        f_cache_read_tokens: sum("f_cache_read_tokens", "t_event_usage"),
        f_reasoning_tokens: sum("f_reasoning_tokens", "t_event_usage"),
        f_total_tokens: sum("f_total_tokens", "t_event_usage"),
      })
      .join(eventUsage, E.eq(usageTable.f_event_id, links.f_event_id))
      .where(E.eq(links.f_session_id, id))
      // 按列分组而不是按 `COALESCE` 表达式：PostgreSQL 的 GROUP BY 匹配按语法树，参数化的表达式
      // 在 SELECT 与 GROUP BY 里是两个不同的 Param 节点，会被判成「不在 GROUP BY 里」。
      .groupBy(links.f_session_id, usageTable.f_day, usageTable.f_provider, usageTable.f_model)
      .toFragment();

    // 活动计数：本会话桥接行 × 事件行，按本地日聚合四项。
    const counts = links
      .select({
        f_session_id: links.f_session_id,
        f_day: E.localDay(eventsTable.f_created_at),
        f_turns: E.countIf(E.eq(eventsTable.f_type, "turn/start")),
        f_steps: E.countIf(E.eq(eventsTable.f_type, "step/start")),
        f_user_inputs: E.countIf(E.eq(eventsTable.f_type, "user/message")),
        f_tool_calls: E.countIf(E.eq(eventsTable.f_type, "tool/call")),
      })
      .join(events, E.eq(eventsTable.f_event_id, links.f_event_id))
      .where(
        E.and(
          E.eq(links.f_session_id, id),
          E.inList(eventsTable.f_type, [...COUNTED_EVENT_TYPES]),
        ),
      )
      .groupBy(links.f_session_id, E.localDay(eventsTable.f_created_at))
      .toFragment();

    await rebuildSessionStats(database, id, { usage, counts });
  }

  async refreshEventUsageFlags(eventIds: readonly string[]): Promise<void> {
    const database = this.#database;
    const links = sessionEvents.table(database);
    const sessionsTable = sessions.table(database);
    // 相关子查询：外层是被更新的用量行的 `f_event_id`（`UPDATE` 的目标表没有别名，用表名限定）。
    const refersTo = (eventId: OperandInput) => E.eq(links.f_event_id, eventId);
    await refreshEventUsageFlags(
      database,
      eventIds,
      {
        referenced: E.toInt(
          E.exists(
            links
              .select({ one: links.f_event_id })
              .where(refersTo(E.column("f_event_id", "t_event_usage")))
              .toFragment(),
          ),
        ),
        subagent: E.toInt(
          E.exists(
            links
              .select({ one: links.f_event_id })
              .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
              .where(
                E.and(
                  refersTo(E.column("f_event_id", "t_event_usage")),
                  E.eq(sessionsTable.f_origin, "subagent"),
                ),
              )
              .toFragment(),
          ),
        ),
      },
      400,
    );
  }

  async vacuum(): Promise<void> {
    await this.#database.vacuum();
  }

  #txFor(rdb: Database): BackendTx {
    return {
      upsertSession: (storage, incarnation) => this.#upsertSession(rdb, storage, incarnation),
      getHead: (id) => readHead(rdb, id),
      getSeedLength: (id) => readSeedLength(rdb, id),
      updateSeedLength: (id, seedLength) => this.#updateSeedLength(rdb, id, seedLength),
      refreshTitle: (id) => this.#refreshTitle(rdb, id),
      insertEvents: (events, usageRows) => this.#insertEvents(rdb, events, usageRows),
      insertBridges: (rows) => this.#insertBridges(rdb, rows),
      updateHead: (id, headEventId, headSequence) =>
        this.#updateHead(rdb, id, headEventId, headSequence),
      updateHeadAndRevision: (id, headEventId, headSequence, lastEventAt) =>
        this.#updateHeadAndRevision(rdb, id, headEventId, headSequence, lastEventAt),
      bumpRevision: (id, lastEventAt) => this.#bumpRevision(rdb, id, lastEventAt),
      deleteBridgeTail: (id, fromSequence) => this.#deleteBridgeTail(rdb, id, fromSequence),
      getPrevBridge: (id, sequence) => readPrevBridge(rdb, id, sequence),
      deleteSession: (id) => this.#deleteSession(rdb, id),
      deleteSessions: (ids) => this.#deleteSessions(rdb, ids),
    };
  }

  async #upsertSession(
    rdb: Database,
    storage: Parameters<BackendTx["upsertSession"]>[0],
    incarnation: string,
  ): Promise<void> {
    const row = sessionInsertColumns(storage, incarnation);
    const header = sessionHeaderColumns(storage);
    const table = sessions.table(rdb);
    await table.insertIgnore(row, ["f_session_id"]);
    await table.update(
      header,
      E.and(E.eq(table.f_session_id, storage.meta.id), headerChangedCondition(header)),
    );
  }

  async #updateSeedLength(rdb: Database, id: string, seedLength: number): Promise<void> {
    const table = sessions.table(rdb);
    await table.update({ f_seed_length: seedLength }, E.eq(table.f_session_id, id));
  }

  async #refreshTitle(rdb: Database, id: string): Promise<void> {
    const latest = await this.#readModel.latestTitleEvent(id);
    const title = latest === undefined ? undefined : titleOfEventData(latest.fData);
    const nextTitle = title ?? null;
    const nextSeq = title === undefined ? null : latest!.fSequence;
    const table = sessions.table(rdb);
    await table.update(
      { f_title: nextTitle, f_title_seq: nextSeq },
      E.and(
        E.eq(table.f_session_id, id),
        E.or(E.isDistinctFrom(table.f_title, nextTitle), E.isDistinctFrom(table.f_title_seq, nextSeq)),
      ),
    );
  }

  async #insertEvents(
    rdb: Database,
    eventRows: EventInsert[],
    usageRows: readonly EventUsageRow[],
  ): Promise<void> {
    if (eventRows.length === 0) return;
    const eventsTable = events.table(rdb);
    for (let i = 0; i < eventRows.length; i += INSERT_BATCH_ROWS) {
      await eventsTable.insertMany(
        eventRows.slice(i, i + INSERT_BATCH_ROWS).map((event) => ({
          f_event_id: event.fEventId,
          f_parent_id: event.fParentId,
          f_type: event.fType,
          f_kind: event.fKind,
          f_role: event.fRole,
          f_name: event.fName,
          f_action_id: event.fActionId,
          f_encoding: event.fEncoding,
          f_data: event.fData,
          f_created_at: event.fCreatedAt,
        })),
      );
    }
    if (usageRows.length > 0) {
      const usage = eventUsage.table(rdb);
      for (let i = 0; i < usageRows.length; i += INSERT_BATCH_ROWS) {
        await usage.insertMany(
          usageRows.slice(i, i + INSERT_BATCH_ROWS).map((row) => ({
            f_event_id: row.fEventId,
            f_created_at: row.fCreatedAt,
            f_day: row.fDay,
            f_provider: row.fProvider,
            f_model: row.fModel,
            f_referenced: row.fReferenced,
            f_subagent: row.fSubagent,
            f_input_tokens: row.fInputTokens,
            f_output_tokens: row.fOutputTokens,
            f_cache_read_tokens: row.fCacheReadTokens,
            f_reasoning_tokens: row.fReasoningTokens,
            f_total_tokens: row.fTotalTokens,
          })),
          { conflict: ["f_event_id"] },
        );
      }
    }
  }

  async #insertBridges(
    rdb: Database,
    rows: Array<{ fSessionId: string; fEventId: string; fSequence: number; fSurfaceOp: string | null }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const links = sessionEvents.table(rdb);
    for (let i = 0; i < rows.length; i += INSERT_BATCH_ROWS) {
      await links.insertMany(
        rows.slice(i, i + INSERT_BATCH_ROWS).map((row) => ({
          f_session_id: row.fSessionId,
          f_event_id: row.fEventId,
          f_sequence: row.fSequence,
          f_surface_op: row.fSurfaceOp,
        })),
      );
    }
  }

  async #updateHead(
    rdb: Database,
    id: string,
    headEventId: string,
    headSequence: number,
  ): Promise<void> {
    const table = sessions.table(rdb);
    await table.update(
      { f_head_event_id: headEventId, f_head_sequence: headSequence },
      E.eq(table.f_session_id, id),
    );
  }

  async #updateHeadAndRevision(
    rdb: Database,
    id: string,
    headEventId: string,
    headSequence: number,
    lastEventAt?: number,
  ): Promise<void> {
    const table = sessions.table(rdb);
    await table.update(
      {
        f_head_event_id: headEventId,
        f_head_sequence: headSequence,
        f_revision: E.add(table.f_revision, 1),
        ...(lastEventAt === undefined ? {} : { f_last_event_at: lastEventAtExpr(lastEventAt) }),
      },
      E.eq(table.f_session_id, id),
    );
  }

  async #bumpRevision(rdb: Database, id: string, lastEventAt?: number): Promise<void> {
    const table = sessions.table(rdb);
    await table.update(
      {
        f_revision: E.add(table.f_revision, 1),
        ...(lastEventAt === undefined ? {} : { f_last_event_at: lastEventAtExpr(lastEventAt) }),
      },
      E.eq(table.f_session_id, id),
    );
  }

  async #deleteBridgeTail(rdb: Database, id: string, fromSequence: number): Promise<readonly string[]> {
    const links = sessionEvents.table(rdb);
    const rows = await links.delete(
      E.and(E.eq(links.f_session_id, id), E.gte(links.f_sequence, fromSequence)),
      ["f_event_id"],
    );
    return rows.map((row) => row.f_event_id);
  }

  async #deleteSession(rdb: Database, id: string): Promise<readonly string[]> {
    const links = sessionEvents.table(rdb);
    const rows = await links.delete(E.eq(links.f_session_id, id), ["f_event_id"]);
    await this.#deleteSessionStatsRows(rdb, [id]);
    const table = sessions.table(rdb);
    await table.delete(E.eq(table.f_session_id, id));
    await this.#pruneWorkspace(rdb, [id]);
    return rows.map((row) => row.f_event_id);
  }

  async #deleteSessions(
    rdb: Database,
    ids: string[],
  ): Promise<{ deleted: number; eventIds: readonly string[] }> {
    if (ids.length === 0) return { deleted: 0, eventIds: [] };
    const links = sessionEvents.table(rdb);
    const removed = await links.delete(E.inList(links.f_session_id, ids), ["f_event_id"]);
    await this.#deleteSessionStatsRows(rdb, ids);
    const table = sessions.table(rdb);
    let deleted = 0;
    for await (const row of table.select({ n: count() }).where(E.inList(table.f_session_id, ids))) {
      deleted = Number(row.n);
    }
    await table.delete(E.inList(table.f_session_id, ids));
    await this.#pruneWorkspace(rdb, ids);
    return { deleted, eventIds: removed.map((row) => row.f_event_id) };
  }

  async #deleteSessionStatsRows(rdb: Database, ids: readonly string[]): Promise<void> {
    for (const id of ids) await deleteSessionStats(rdb, id);
  }

  async #pruneWorkspace(rdb: Database, ids: readonly string[]): Promise<void> {
    await pruneWorkspaceDocuments(rdb, ids);
  }
}

/** 打开数据库、对齐结构、跑迁移、落 identity。 */
export async function openRdbBackend(config: BackendConfig): Promise<Backend> {
  const schema = config.type === "postgres" ? (config.schema ?? "public") : "";
  const actualPath =
    config.type === "sqlite" && config.path !== ":memory:" ? resolve(config.path) : undefined;
  if (actualPath !== undefined) {
    // 库文件与目录的权限：目录 0700（不改变已有目录的 mode），文件 0600（WAL / SHM 继承）。
    await mkdir(dirname(actualPath), { recursive: true, mode: 0o700 });
    try {
      // 独占创建：新建的文件固定 0600；已存在的文件保留它自己的 mode。
      const handle = await open(actualPath, "wx", 0o600);
      await handle.close();
      await chmod(actualPath, 0o600);
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
  const database = await openRdbkitDatabase(
    config.type === "sqlite"
      ? {
          dialect: "sqlite",
          path: actualPath ?? config.path,
          ...(config.journalMode === undefined ? {} : { journalMode: config.journalMode }),
          // journal_mode 等校验通过后再切（拒绝旧库时不能改动它）。
          applyJournalMode: false,
          busyTimeout: config.busyTimeout ?? DEFAULT_BUSY_TIMEOUT_MS,
          cacheSizeKb: 65536,
          mmapSize: 268435456,
        }
      : {
          dialect: "postgres",
          connectionString: config.connectionString,
          ...(config.schema === undefined ? {} : { schema: config.schema }),
          isolationLevel: "serializable",
        },
  );

  try {
    let onDisk = 0;
    if (config.type === "sqlite") {
      onDisk = Number((await database.sqlitePragma("user_version")) ?? 0);
      const applicationId = Number((await database.sqlitePragma("application_id")) ?? 0);
      if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
        throw new Error(
          `session database at "${config.path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
        );
      }
      if (onDisk >= 1 && applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID) {
        throw new Error(
          `session database at "${config.path}" has application id ${applicationId}, expected ${SESSION_PERSISTENCE_SQLITE_APPLICATION_ID}`,
        );
      }
      if (onDisk === 0) {
        // 有表但没版本标记：旧库或别的程序的库，拒绝并要求显式迁移（空文件才允许初始化）。
        const objects = await database.objectNames();
        const foreignApplication =
          applicationId !== 0 && applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID;
        if (foreignApplication || objects.length > 0) {
          throw new Error(
            `session database at "${config.path}" has an unversioned schema or application identity`,
          );
        }
      }
    }

    const writeKey =
      config.type === "sqlite"
        ? `sqlite:${config.path}`
        : `postgres:${config.connectionString}:${schema}`;
    const inWrite = <T>(fn: (scoped: Database) => Promise<T>): Promise<T> =>
      enqueueWrite(writeKey, () => database.transaction(fn));

    if (actualPath !== undefined) {
      // SQLite 自己创建 WAL / SHM / 回滚日志时用默认 mode（受 umask 影响），统一收成 0600。
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        try {
          await chmod(`${actualPath}${suffix}`, 0o600);
        } catch {
          // 文件还没创建（未进入 WAL / 没有回滚日志）就跳过。
        }
      }
    }

    // 打标记、建表、迁移、回填、identity 是**一个事务**：任一步失败都不在库里留痕
    //（旧版本 / 别人的库被拒时，连表与版本戳都不该出现）。
    let storeId: string | undefined;
    await inWrite(async (scoped) => {
      if (config.type === "sqlite" && onDisk === 0) {
        await scoped.setSqlitePragma("application_id", SESSION_PERSISTENCE_SQLITE_APPLICATION_ID);
        await scoped.setSqlitePragma("user_version", SCHEMA_VERSION);
      }
      await ensureSchema(scoped, catalog);
      await runMigrations(scoped, {
        catalog,
        migrations: sessionMigrations(),
      });
      await backfillUsageTables(scoped);

      const state = persistenceState.table(scoped);
      await state.insertIgnore({ f_singleton: 1, f_store_id: randomUUID() }, ["f_singleton"]);
      for await (const row of state.select({ storeId: state.f_store_id })) storeId = row.storeId;
    });
    if (storeId === undefined || storeId.length === 0) {
      throw new Error("session database has no valid store identity");
    }
    if (config.type === "sqlite") {
      // 结构对齐成功后才切 journal_mode：被拒的库不能被改动。
      await database.setSqlitePragma("journal_mode", (config.journalMode ?? "wal").toLowerCase());
    }

    const storage = createStorageRepository({
      database,
      writeAtomically: (fn) => inWrite((scoped) => fn(scoped)),
    });
    const storeIdentity =
      config.type === "sqlite"
        ? actualPath === undefined
          ? `memory:store:${storeId}`
          : await fileIdentity(actualPath, storeId)
        : `${config.type}:${config.connectionString}:${schema}:store:${storeId}`;
    return new RdbBackend({
      kind: config.type,
      database,
      storage,
      readModel: createReadModel(database),
      storeIdentity,
    });
  } catch (error) {
    await database.close();
    throw error;
  }
}

/** 库文件身份：`file:dev:ino:birthtimeNs:store:<storeId>`（符号链接指向同一 inode 时身份相同）。 */
async function fileIdentity(path: string, storeId: string): Promise<string> {
  const identity = await stat(path, { bigint: true });
  return `file:${identity.dev}:${identity.ino}:${identity.birthtimeNs}:store:${storeId}`;
}

/** 统计表为空时按事件表全量回填（幂等；迁移删表重建、手动清空后自愈）。 */
async function backfillUsageTables(database: Database): Promise<void> {
  const links = sessionEvents.table(database);
  const eventsTable = events.table(database);
  const sessionsTable = sessions.table(database);
  const usageTable = eventUsage.table(database);

  if (await isEmpty(database, eventUsage)) {
    const hasUsage = (path: string) => E.isNotNull(E.jsonText(eventsTable.f_data, path));
    const text = (path: string) => E.jsonText(eventsTable.f_data, path);
    const int = (path: string) => E.coalesce(E.jsonInt(eventsTable.f_data, path), 0);
    const usagePaths = (field: string) => [
      `$.data.usage.${field}`,
      `$.usage.${field}`,
    ] as const;
    const input = usagePaths("inputTokens");
    const output = usagePaths("outputTokens");
    const cacheRead = usagePaths("cacheReadTokens");
    const reasoning = usagePaths("reasoningTokens");
    const total = usagePaths("totalTokens");
    const referenced = (eventId: OperandInput) =>
      E.toInt(
        E.exists(
          links
            .select({ one: links.f_event_id })
            .where(E.eq(links.f_event_id, eventId))
            .toFragment(),
        ),
      );
    const subagent = (eventId: OperandInput) =>
      E.toInt(
        E.exists(
          links
            .select({ one: links.f_event_id })
            .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
            .where(E.and(E.eq(links.f_event_id, eventId), E.eq(sessionsTable.f_origin, "subagent")))
            .toFragment(),
        ),
      );

    const source = eventsTable
      .select({
        f_event_id: eventsTable.f_event_id,
        f_created_at: eventsTable.f_created_at,
        f_day: E.localDay(eventsTable.f_created_at),
        f_provider: E.coalesce(
          text("$.data.message.source.provider"),
          text("$.message.source.provider"),
        ),
        f_model: E.coalesce(text("$.data.message.source.model"), text("$.message.source.model")),
        f_referenced: referenced(E.column("f_event_id", "t_events")),
        f_subagent: subagent(E.column("f_event_id", "t_events")),
        f_input_tokens: E.coalesce(int(input[0]), int(input[1]), 0),
        f_output_tokens: E.coalesce(int(output[0]), int(output[1]), 0),
        f_cache_read_tokens: E.coalesce(int(cacheRead[0]), int(cacheRead[1]), 0),
        f_reasoning_tokens: E.coalesce(int(reasoning[0]), int(reasoning[1]), 0),
        f_total_tokens: E.coalesce(int(total[0]), int(total[1]), 0),
      })
      .where(
        E.and(
          E.eq(eventsTable.f_type, "assistant/message"),
          E.or(hasUsage("$.data.usage"), hasUsage("$.usage")),
        ),
      )
      .toFragment();

    await usageTable.insertFromSelect(
      [
        "f_event_id",
        "f_created_at",
        "f_day",
        "f_provider",
        "f_model",
        "f_referenced",
        "f_subagent",
        "f_input_tokens",
        "f_output_tokens",
        "f_cache_read_tokens",
        "f_reasoning_tokens",
        "f_total_tokens",
      ],
      source,
      { conflict: ["f_event_id"] },
    );
  }

  if (await isEmpty(database, sessionUsage)) {
    const source = links
      .select({
        f_session_id: links.f_session_id,
        f_day: usageTable.f_day,
        f_provider: E.coalesce(usageTable.f_provider, ""),
        f_model: E.coalesce(usageTable.f_model, ""),
        f_input_tokens: sum("f_input_tokens", "t_event_usage"),
        f_output_tokens: sum("f_output_tokens", "t_event_usage"),
        f_cache_read_tokens: sum("f_cache_read_tokens", "t_event_usage"),
        f_reasoning_tokens: sum("f_reasoning_tokens", "t_event_usage"),
        f_total_tokens: sum("f_total_tokens", "t_event_usage"),
      })
      .join(eventUsage, E.eq(usageTable.f_event_id, links.f_event_id))
      // 同上：分组用列，`COALESCE` 只留在投影里。
      .groupBy(links.f_session_id, usageTable.f_day, usageTable.f_provider, usageTable.f_model)
      .toFragment();
    await sessionUsage.table(database).insertFromSelect(
      [
        "f_session_id",
        "f_day",
        "f_provider",
        "f_model",
        "f_input_tokens",
        "f_output_tokens",
        "f_cache_read_tokens",
        "f_reasoning_tokens",
        "f_total_tokens",
      ],
      source,
      { conflict: ["f_session_id", "f_day", "f_provider", "f_model"] },
    );
  }

  if (await isEmpty(database, sessionCounts)) {
    const source = links
      .select({
        f_session_id: links.f_session_id,
        f_day: E.localDay(eventsTable.f_created_at),
        f_turns: E.countIf(E.eq(eventsTable.f_type, "turn/start")),
        f_steps: E.countIf(E.eq(eventsTable.f_type, "step/start")),
        f_user_inputs: E.countIf(E.eq(eventsTable.f_type, "user/message")),
        f_tool_calls: E.countIf(E.eq(eventsTable.f_type, "tool/call")),
      })
      .join(events, E.eq(eventsTable.f_event_id, links.f_event_id))
      .where(E.inList(eventsTable.f_type, [...COUNTED_EVENT_TYPES]))
      .groupBy(links.f_session_id, E.localDay(eventsTable.f_created_at))
      .toFragment();
    await sessionCounts.table(database).insertFromSelect(
      ["f_session_id", "f_day", "f_turns", "f_steps", "f_user_inputs", "f_tool_calls"],
      source,
      { conflict: ["f_session_id", "f_day"] },
    );
  }
}

async function isEmpty<T extends TableDef>(database: Database, definition: Table<T>): Promise<boolean> {
  for await (const row of definition.table(database).select({ n: count() })) {
    // PostgreSQL 的 COUNT 返回 int8 → BigInt，`0n === 0` 是 false，必须显式转。
    return Number(row.n) === 0;
  }
  return true;
}
