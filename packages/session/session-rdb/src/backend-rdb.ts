import { E, count, type Database } from "@morlay/rdbkit";
import type {
  Backend,
  BackendTx,
  EventInsert,
  SessionCountBucket,
  SessionListRowsPage,
  SessionListRowsQuery,
  SessionRow,
  SessionUsageBucket,
} from "./backend.ts";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { UsageAggregate } from "./usage.ts";
import {
  eventUsage,
  events,
  sessionEvents,
  sessions,
} from "./entities/index.ts";
import type { EventUsageRow } from "./log/usage-row.ts";
import { sessionHeaderColumns, sessionInsertColumns } from "./log/rows.ts";
import { titleOfEventData } from "./log/export.ts";
import { collectOrphans, readHead, readPrevBridge, readSeedLength } from "./session-ops.ts";
import {
  headerChangedCondition,
  lastEventAtExpr,
  type ReadModel,
} from "./storage-takeover/read-model.ts";
import type { StorageRepository } from "./storage-takeover/types.ts";
import * as stats from "./db/stats.ts";
import { pruneWorkspaceDocuments } from "./storage-takeover/workspace-documents.ts";

const INSERT_BATCH_ROWS = 1000;

/**
 * 唯一的 backend 实现：所有数据库操作都在这里（读模型 + `session-ops` + 表句柄），
 * 方言差异全部由 rdbkit 的表达式承担（本地日、JSON 提取这类），这里不出现任何 SQL 文本。
 */
export class RdbBackend implements Backend {
  readonly storage: StorageRepository;
  readonly storeIdentity: string;

  readonly #database: Database;
  readonly reads: ReadModel;

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
    this.reads = options.readModel;
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

  async listOrphanSubagentSessions(): Promise<SessionId[]> {
    return (await this.reads.listOrphanSubagentSessions()) as SessionId[];
  }

  /** 当前 head 指针（分支 / 测试读路径用；写路径在 `BackendTx` 里）。 */
  async getHead(id: SessionId): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">> {
    return await readHead(this.#database, id);
  }

  async collectOrphans(): Promise<number> {
    return await collectOrphans(this.#database);
  }

  async usageReport(sinceMs?: number): Promise<UsageAggregate> {
    return await stats.usageReport(this.#database, sinceMs);
  }

  async listSessionRows(query?: SessionListRowsQuery): Promise<SessionListRowsPage> {
    return await stats.listSessionRows(this.#database, this.storage, query);
  }

  async incrementSessionUsage(id: string, buckets: readonly SessionUsageBucket[]): Promise<void> {
    await stats.incrementSessionUsage(this.#database, id, buckets);
  }

  async incrementSessionCounts(id: string, buckets: readonly SessionCountBucket[]): Promise<void> {
    await stats.incrementSessionCounts(this.#database, id, buckets);
  }

  async deleteSessionStats(id: string): Promise<void> {
    await stats.deleteSessionStats(this.#database, id);
  }

  async rebuildSessionStats(id: string): Promise<void> {
    await stats.rebuildSessionStats(this.#database, id);
  }

  async refreshEventUsageFlags(eventIds: readonly string[]): Promise<void> {
    await stats.refreshEventUsageFlags(this.#database, eventIds);
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
    const latest = await this.reads.latestTitleEvent(id);
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
    for (const id of ids) await stats.deleteSessionStats(rdb, id);
  }

  async #pruneWorkspace(rdb: Database, ids: readonly string[]): Promise<void> {
    await pruneWorkspaceDocuments(rdb, ids);
  }
}
