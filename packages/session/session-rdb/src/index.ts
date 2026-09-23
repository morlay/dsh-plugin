import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  assertContiguous,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionHandleAppendOptions,
  type SessionHandleFlushOptions,
  type SessionHandleReadOptions,
  type SessionHandleReadResult,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from "@deepseek-ai/dsh-session-persistence";
import {
  SESSION_FORMAT_VERSION,
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SurfaceEventType,
} from "@deepseek-ai/dsh-session";
import { sessionFormatLogFilename } from "@deepseek-ai/dsh-session-format";
import {
  type Backend,
  type BackendTx,
  type EventInsert,
  type SessionCountBucket,
  type SessionUsageBucket,
} from "./backend.ts";
import { WriteGuard } from "./write-guard.ts";
import { repairReadView, rowToMeta, scanRows, toJsonlArtifact, usageRowOf } from "./log.ts";
import type { EventUsageRow } from "./log.ts";
import {
  DEFAULT_BUSY_TIMEOUT_MS,
  eventDimensions,
  EVENT_ENCODING,
  type JournalMode,
} from "./schema.ts";
import { SqliteBackend } from "./sqlite.ts";
import { PostgresBackend } from "./postgres.ts";
import { SessionBranchRdb } from "./branch.ts";
import { balanceRewindPrefix } from "@morlay/session-branch";
import { registerSessionImport } from "./import.ts";
import { registerSessionDeletion } from "./deletion.ts";
import { registerSessionExport } from "./export.ts";
import { registerSessionGc } from "./gc.ts";
import { registerSessionRows } from "./rows.ts";
import {
  COUNTED_EVENT_TYPES,
  addActivityCount,
  localDayKey,
  registerSessionUsage,
} from "./usage.ts";
import type { UsageAggregate } from "./usage.ts";
import { SessionQueryRdb } from "./session-query.ts";
import { adoptLegacyRows, convertLegacyRows, isLegacyVersion } from "./legacy.ts";
import { needsShapeAdoption, sealOwnEvents } from "./log.ts";
import { installStorageTakeover } from "./storage-takeover/index.ts";

/** 一批事件里的最大时间：写路径据此推进会话行的「最后活动时间」。 */
function maxEventTime(events: readonly { readonly time?: number }[]): number | undefined {
  let max: number | undefined;
  for (const event of events) {
    const time = event.time;
    if (typeof time !== "number") continue;
    if (max === undefined || time > max) max = time;
  }
  return max;
}

const DEFAULT_PROJECTION_WRITE_EVERY_EVENTS = 200;
const DEFAULT_PROJECTION_WRITE_INTERVAL_MS = 5000;

export { SCHEMA_VERSION } from "./schema.ts";
export { SESSION_ROWS_PATH } from "./rows.ts";
export type { SessionRowsItem, SessionRowsValue } from "./rows.ts";
export { SessionBranchRdb, SessionBranchRdbProvider, locateTurnEnd } from "./branch.ts";

export interface SessionPersistenceRdbInternals {
  readonly backend: Backend;
  readonly writeGuard: WriteGuard;
  create(meta: SessionHeader, inheritedEventCount?: number): Promise<SessionHandle>;
  append(id: SessionId, events: readonly SessionEvent[]): Promise<void>;
  load(id: SessionId): Promise<import("@deepseek-ai/dsh-session-persistence").SessionInspection>;
  inspect(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<import("@deepseek-ai/dsh-session-persistence").SessionInspection>;
  readFrom(
    id: SessionId,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; inheritedEventCount: number; events: readonly SessionEvent[] }>;
  listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>;
  readStoredRevision(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<import("@deepseek-ai/dsh-session-persistence").SessionPersistenceRevision | undefined>;

  registerReuseEventIds(childId: SessionId, map: ReadonlyMap<number, string>): void;
  /** fork 失败时丢弃还没被消费的映射。 */
  dropReuseEventIds(childId: SessionId): void;
}

export interface ProjectionCacheOptions {
  writeEveryEvents?: number;

  writeIntervalMs?: number;
}

export type Config =
  | {
      type: "sqlite";

      path: string;

      journalMode?: JournalMode;

      busyTimeout?: number;

      projectionCache?: ProjectionCacheOptions;
    }
  | {
      type: "postgres";

      connectionString: string;

      schema?: string;

      projectionCache?: ProjectionCacheOptions;
    };

export type SessionDeletionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ARCHIVED"
  | "SESSION_LIVE";

export class SessionDeletionError extends Error {
  constructor(
    message: string,
    readonly code: SessionDeletionErrorCode,
  ) {
    super(message);
    this.name = "SessionDeletionError";
  }
}

interface PendingSession {
  readonly header: SessionHeader;
  readonly revision: SessionPersistenceRevision;
  readonly inheritedEventCount: SessionLogOffset;

  readonly cursor: number;

  readonly everAppended: boolean;
}

class RdbBackendTracker {
  private readonly writers = new Map<SessionId, RdbSessionHandle | null>();
  private readonly pending = new Map<SessionId, PendingSession>();
  private readonly openHandles = new Set<RdbSessionHandle>();
  private counter = 0;

  constructor(private readonly name: string) {}

  registerCreated(header: SessionHeader, inheritedEventCount: SessionLogOffset): void {
    if (this.writers.has(header.id)) throw new SessionAlreadyExistsError(header.id);
    this.writers.set(header.id, null);
    this.pending.set(header.id, {
      header,
      revision: SessionPersistenceRevision(`memory:${this.name}:${++this.counter}`),
      inheritedEventCount,
      cursor: 0,
      everAppended: false,
    });
  }

  updatePending(id: SessionId, cursor: number, everAppended: boolean): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.set(id, { ...entry, cursor, everAppended });
  }

  claimWrite(id: SessionId): void {
    if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id);
    this.writers.set(id, null);
  }

  releaseClaim(id: SessionId): void {
    this.writers.delete(id);
  }

  pendingOf(id: SessionId): PendingSession | undefined {
    return this.pending.get(id);
  }

  hasPending(id: SessionId): boolean {
    return this.pending.has(id);
  }

  pendingEntries(): IterableIterator<[SessionId, PendingSession]> {
    return this.pending.entries();
  }

  materialized(id: SessionId): void {
    this.pending.delete(id);
  }

  adopt(handle: RdbSessionHandle): RdbSessionHandle {
    this.openHandles.add(handle);
    if (handle.access === "write") this.writers.set(handle.id, handle);
    return handle;
  }

  release(handle: RdbSessionHandle, materialized: boolean): void {
    this.openHandles.delete(handle);
    if (handle.access !== "write") return;
    this.writers.delete(handle.id);
    if (!materialized) this.pending.delete(handle.id);
  }

  writerOf(id: SessionId): RdbSessionHandle | undefined {
    const writer = this.writers.get(id);
    return writer === null ? undefined : writer;
  }

  hasOpenHandle(id: SessionId): boolean {
    for (const handle of this.openHandles) {
      if (handle.id === id) return true;
    }
    return false;
  }

  async flushAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const writer of this.writers.values()) {
      if (writer === null) continue;
      try {
        await writer.drainLive();
        await writer.flush();
      } catch (error: unknown) {
        if (error instanceof SessionHandleClosedError) continue;
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${this.name} flush failed`);
  }

  async closeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const handle of this.openHandles) {
      try {
        await handle.close();
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${this.name} dispose failed`);
  }
}

class RdbSessionHandle implements SessionHandle {
  private chain: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;

  private cursor: number;
  private materialized: boolean;

  private buffered: SessionEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private drainPaused = false;
  private draining: Promise<void> | undefined;

  private tornTruncateTo: number | undefined;

  private everAppended = false;

  constructor(
    private readonly persistence: SessionPersistenceRdb,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    private readonly state: {
      cursor: number;
      materialized: boolean;
      inheritedEventCount: SessionLogOffset;
      tornTruncateTo?: number;
    },
  ) {
    this.cursor = state.cursor;
    this.materialized = state.materialized;
    this.tornTruncateTo = state.tornTruncateTo;
  }

  get inheritedEventCount(): SessionLogOffset {
    return this.state.inheritedEventCount;
  }

  get cursorValue(): number {
    return this.cursor;
  }

  async read(
    offset = 0,
    length = Number.MAX_SAFE_INTEGER,
    options?: SessionHandleReadOptions,
  ): Promise<SessionHandleReadResult> {
    this.assertOpen("read");
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError(`read offset must be a non-negative safe integer, got ${String(offset)}`);
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(`read length must be a non-negative safe integer, got ${String(length)}`);
    }
    options?.signal?.throwIfAborted();
    const log = await this.persistence.readLog(this.id, {}, options?.signal);
    if (log === undefined) {
      if (this.persistence.tracker.hasPending(this.id)) {
        return { eventState: "detached", events: [] };
      }
      throw new SessionPersistenceNotFoundError(this.id);
    }

    repairReadView(log.events);
    return { eventState: "detached", events: log.events.slice(offset, offset + length) };
  }

  async append(
    events: readonly SessionEvent[],
    options?: SessionHandleAppendOptions,
  ): Promise<void> {
    this.assertOpen("append");
    const batch = materializeAppendBatch(events);
    return this.run("append", async () => {
      options?.signal?.throwIfAborted();
      if (this.access !== "write") throw new SessionReadOnlyError(this.id, "append");
      if (batch.length === 0) return;
      this.everAppended = true;
      assertContiguous(this.id, batch, this.cursor);
      await this.persistence.appendBatch(
        this.header,
        this.state.inheritedEventCount,
        batch,
        this.tornTruncateTo,
      );
      this.tornTruncateTo = undefined;

      this.cursor += batch.length;
      this.materialized = true;
      this.persistence.tracker.updatePending(this.id, this.cursor, true);
    });
  }

  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    return this.run("flush", async () => {
      options?.signal?.throwIfAborted();
      if (this.access !== "write") throw new SessionReadOnlyError(this.id, "flush");
      if (this.materialized) return;
      await this.persistence.materializeEmpty(this.header, this.state.inheritedEventCount);
      this.materialized = true;
    });
  }

  close(): Promise<void> {
    return (this.closing ??= (async () => {
      let drainFailure: unknown;
      for (;;) {
        try {
          await this.drainLive();
        } catch (error: unknown) {
          drainFailure = error;
          break;
        }
        await this.chain;
        if (this.buffered.length === 0) break;
      }
      await this.chain;
      const failures: Error[] = [];
      if (drainFailure !== undefined) {
        failures.push(
          drainFailure instanceof Error ? drainFailure : new Error(JSON.stringify(drainFailure)),
        );
      }
      this.persistence.tracker.release(this, this.materialized || this.everAppended);
      if (failures.length > 1)
        throw new AggregateError(failures, `session "${this.id}": close failed to drain`);
      if (failures[0] !== undefined) throw failures[0];
    })());
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void {
    this.buffered.push(structuredClone(event));
    if (this.batchTimer !== undefined || this.drainPaused) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      this.drainLive().catch(reportBackgroundFailure);
    }, RdbSessionHandle.LIVE_WRITE_BATCH_MAX_DELAY_MS);
  }

  resetAfterRewind(cursor: number, inheritedEventCount?: number): void {
    this.cursor = cursor;
    if (inheritedEventCount !== undefined) {
      (this.state as { inheritedEventCount: SessionLogOffset }).inheritedEventCount =
        SessionLogOffset(inheritedEventCount);
    }
  }

  drainLive(): Promise<void> {
    return (this.draining ??= this.drainBuffered().finally(() => {
      this.draining = undefined;
    }));
  }

  private async drainBuffered(): Promise<void> {
    if (this.batchTimer !== undefined) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    this.drainPaused = false;
    while (this.buffered.length > 0) {
      await this.enqueueChain(async () => {
        const batch = this.buffered.splice(0);
        try {
          const fresh = batch.filter((event) => event.seq >= this.cursor);
          if (fresh.length === 0) return;
          for (const [index, event] of fresh.entries()) {
            if (event.seq !== this.cursor + index) {
              throw new Error(
                `append seq mismatch for "${this.id}": expected ${this.cursor + index} at index ${index}, got ${event.seq}`,
              );
            }
          }
          await this.persistence.appendBatch(
            this.header,
            this.state.inheritedEventCount,
            fresh,
            this.tornTruncateTo,
          );
          this.tornTruncateTo = undefined;
          this.cursor += fresh.length;
          this.materialized = true;
        } catch (error: unknown) {
          this.buffered = batch.concat(this.buffered);
          this.drainPaused = true;
          throw error;
        }
      });
    }
  }

  private enqueueChain(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op);
    this.chain = next.catch(() => {});
    return next;
  }

  private async run(operation: string, op: () => Promise<void>): Promise<void> {
    this.assertOpen(operation);
    return this.enqueueChain(async () => {
      this.assertOpen(operation);
      return op();
    });
  }

  private assertOpen(operation: string): void {
    if (this.closing !== undefined) throw new SessionHandleClosedError(this.id, operation);
  }

  static readonly LIVE_WRITE_BATCH_MAX_DELAY_MS = 200;
}

export class SessionPersistenceRdb extends SessionPersistence {
  static inject = ["sessions"];

  static Config: z<Config> = z.union([
    z.object({
      type: z.const("sqlite"),
      path: z.string().required(),
      journalMode: z.union(["wal", "delete", "truncate", "persist"] as const).default("wal"),
      busyTimeout: z.number().step(1).min(0).default(DEFAULT_BUSY_TIMEOUT_MS),
      projectionCache: z
        .object({
          writeEveryEvents: z.natural().min(1).default(DEFAULT_PROJECTION_WRITE_EVERY_EVENTS),
          writeIntervalMs: z.natural().min(1).default(DEFAULT_PROJECTION_WRITE_INTERVAL_MS),
        })
        .default({
          writeEveryEvents: DEFAULT_PROJECTION_WRITE_EVERY_EVENTS,
          writeIntervalMs: DEFAULT_PROJECTION_WRITE_INTERVAL_MS,
        }),
    }),
    z.object({
      type: z.const("postgres"),
      connectionString: z.string().required(),
      schema: z.string().default("public"),
      projectionCache: z
        .object({
          writeEveryEvents: z.natural().min(1).default(DEFAULT_PROJECTION_WRITE_EVERY_EVENTS),
          writeIntervalMs: z.natural().min(1).default(DEFAULT_PROJECTION_WRITE_INTERVAL_MS),
        })
        .default({
          writeEveryEvents: DEFAULT_PROJECTION_WRITE_EVERY_EVENTS,
          writeIntervalMs: DEFAULT_PROJECTION_WRITE_INTERVAL_MS,
        }),
    }),
  ]);

  override readonly name = "session-rdb";

  readonly tracker = new RdbBackendTracker(this.name);

  private readonly backend: Backend;
  private storeIdentity!: string;
  private readonly ready: Promise<void>;

  private readonly writeGuard = new WriteGuard();

  private readonly reuseEventIds = new Map<SessionId, Map<number, string>>();

  private readonly liveBuffers = new Map<SessionId, SessionEvent[]>();
  private readonly liveReady = new Map<SessionId, Promise<void>>();

  constructor(
    ctx: Context,
    public config: Config,

    injectedBackend?: Backend,
  ) {
    super(ctx);

    // 配置就是这一行的 config（cordis.patch.yml / profile patch，或设置页改它）；上游 0.1.7 的 settings
    // 不再提供 namespace section 覆盖，旧 `settings.yaml` 的 `session-rdb` 段由上游一次性导进同 id 的行。
    this.backend = injectedBackend ?? createBackend(config);
    this.ready = this.init();
    this.installLiveRouting(ctx);

    new SessionBranchRdb(this.ctx);

    this.ctx.plugin(SessionQueryRdb, {});

    registerSessionImport(this.ctx, this);

    registerSessionDeletion(this.ctx, this);

    registerSessionExport(this.ctx, this);

    registerSessionGc(this.ctx, this);

    registerSessionUsage(this.ctx, this);

    registerSessionRows(this.ctx, this.backend);

    installStorageTakeover(this.ctx, {
      repository: this.backend.storage,
      ready: this.ready,
      projectionCache: {
        writeEveryEvents:
          this.config.projectionCache?.writeEveryEvents ?? DEFAULT_PROJECTION_WRITE_EVERY_EVENTS,
        writeIntervalMs:
          this.config.projectionCache?.writeIntervalMs ?? DEFAULT_PROJECTION_WRITE_INTERVAL_MS,
      },
    });
  }

  private async init(): Promise<void> {
    await this.backend.open();
    this.storeIdentity = this.backend.storeIdentity;
  }

  async create(
    header: SessionHeader,
    options?: SessionPersistenceCreateOptions,
  ): Promise<SessionHandle> {
    options?.signal?.throwIfAborted();
    const snapshot = materializeCreateHeader(header);
    if (snapshot.isSeeded && options?.inheritedEventCount === undefined) {
      throw new TypeError("seeded session metadata requires an inherited event count");
    }
    const inheritedEventCount = SessionLogOffset(options?.inheritedEventCount ?? 0);
    if (!snapshot.isSeeded && inheritedEventCount !== 0) {
      throw new TypeError("unseeded session metadata inherited event count must be 0");
    }
    await this.ready;
    options?.signal?.throwIfAborted();
    if (
      this.tracker.hasPending(snapshot.id) ||
      (await this.backend.getSession(snapshot.id)) !== undefined
    ) {
      throw new SessionAlreadyExistsError(snapshot.id);
    }
    this.tracker.registerCreated(snapshot, inheritedEventCount);
    return this.tracker.adopt(
      new RdbSessionHandle(this, snapshot.id, snapshot, "write", {
        cursor: 0,
        materialized: false,
        inheritedEventCount,
      }),
    );
  }

  async open(
    id: SessionId,
    access: SessionAccess,
    options?: SessionPersistenceOpenOptions,
  ): Promise<SessionHandle> {
    options?.signal?.throwIfAborted();
    await this.ready;
    options?.signal?.throwIfAborted();
    const pending = this.tracker.pendingOf(id);
    if (access === "read") {
      if (pending !== undefined) {
        return this.tracker.adopt(
          new RdbSessionHandle(this, id, pending.header, "read", {
            cursor: 0,
            materialized: false,
            inheritedEventCount: pending.inheritedEventCount,
          }),
        );
      }
      const log = await this.readLog(id, {}, options?.signal);
      if (log === undefined) throw new SessionPersistenceNotFoundError(id);

      repairReadView(log.events);

      validateStoredEvents(log.meta, log.events);
      return this.tracker.adopt(
        new RdbSessionHandle(this, id, log.meta, "read", {
          cursor: log.events.length,
          materialized: true,
          inheritedEventCount: SessionLogOffset(log.inheritedEventCount),
        }),
      );
    }
    this.tracker.claimWrite(id);
    try {
      if (pending !== undefined) {
        return this.tracker.adopt(
          new RdbSessionHandle(this, id, pending.header, "write", {
            cursor: pending.cursor,
            materialized: false,
            inheritedEventCount: pending.inheritedEventCount,
          }),
        );
      }
      const log = await this.readLog(id, {}, options?.signal);
      if (log === undefined) throw new SessionPersistenceNotFoundError(id);
      repairReadView(log.events);
      validateStoredEvents(log.meta, log.events);

      if (log.migrated && log.events.length !== log.storedCount) {
        await this.rewriteMigratedLog(id, log);
      }

      this.writeGuard.confirmHead(id, log.events.at(-1)?.seq ?? -1);
      return this.tracker.adopt(
        new RdbSessionHandle(this, id, log.meta, "write", {
          cursor: log.events.length,
          materialized: true,
          inheritedEventCount: SessionLogOffset(log.inheritedEventCount),
          ...(log.tornFrom !== undefined ? { tornTruncateTo: log.tornFrom } : {}),
        }),
      );
    } catch (error: unknown) {
      this.tracker.releaseClaim(id);
      throw error;
    }
  }

  flush(): Promise<void> {
    return this.tracker.flushAll();
  }

  async stat(
    id: SessionId,
    options?: SessionPersistenceStatOptions,
  ): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted();
    await this.ready;
    options?.signal?.throwIfAborted();
    const pending = this.tracker.pendingOf(id);
    if (pending !== undefined) {
      return { header: pending.header, revision: pending.revision };
    }
    const row = await this.backend.getSession(id);
    if (row === undefined) return undefined;
    return {
      header: rowToMeta(row),
      revision: this.rowRevision(row),
    };
  }

  async list(
    options?: SessionPersistenceListOptions,
  ): Promise<readonly SessionPersistenceSnapshot[]> {
    const signal = options?.signal;
    const snapshots: SessionPersistenceSnapshot[] = [];
    const listed = new Set<SessionId>();
    for (const [id, pending] of this.tracker.pendingEntries()) {
      snapshots.push({ header: pending.header, revision: pending.revision });
      listed.add(id);
    }
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    const rows = await this.backend.listSessions();
    signal?.throwIfAborted();
    for (const row of rows) {
      if (listed.has(row.fSessionId as SessionId)) continue;
      snapshots.push({ header: rowToMeta(row), revision: this.rowRevision(row) });
    }
    return snapshots;
  }

  async deleteSession(id: SessionId, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    const row = await this.backend.getSession(id);
    if (row === undefined) {
      throw new SessionDeletionError(`session "${id}" not found`, "SESSION_NOT_FOUND");
    }
    if (row.fArchivedAt === null) {
      throw new SessionDeletionError(
        `session "${id}" is not archived; only archived sessions can be deleted`,
        "SESSION_NOT_ARCHIVED",
      );
    }
    if (this.tracker.hasPending(id) || this.tracker.hasOpenHandle(id)) {
      throw new SessionDeletionError(
        `session "${id}" is live; stop it before deleting`,
        "SESSION_LIVE",
      );
    }
    await this.unarchiveBeforeDeletion(id);
    await this.backend.transaction(async (tx) => {
      await tx.deleteSession(id);
    });
    this.liveBuffers.delete(id);
    this.liveReady.delete(id);
    this.liveFailures.delete(id);
    this.liveDropWarned.delete(id);
    this.reuseEventIds.delete(id);
    await this.dropSessionStats(id);
  }

  /** GC 通道：回收已无桥接行引用的事件行（孤儿），返回删除行数。 */
  async collectOrphans(): Promise<number> {
    await this.ready;
    return this.backend.collectOrphans();
  }

  /** GC 通道：回收父已不存在的 subagent 会话（live 的跳过），返回删除的会话数。 */
  async collectOrphanSessions(): Promise<number> {
    await this.ready;
    const orphans = await this.backend.listOrphanSubagentSessions();
    const deletable = orphans.filter(
      (id) => !this.tracker.hasPending(id) && !this.tracker.hasOpenHandle(id),
    );
    if (deletable.length === 0) return 0;
    const deleted = await this.backend.transaction((tx) => tx.deleteSessions(deletable));
    for (const id of deletable) {
      this.liveBuffers.delete(id);
      this.liveReady.delete(id);
      this.liveFailures.delete(id);
      this.liveDropWarned.delete(id);
      this.reuseEventIds.delete(id);
      await this.dropSessionStats(id);
    }
    return deleted;
  }

  /** 用量统计：SQL 聚合的按天 × 模型桶与按会话行（事件行去重、排除孤儿行）。 */
  async usageReport(sinceMs?: number): Promise<UsageAggregate> {
    await this.ready;
    return this.backend.usageReport(sinceMs);
  }

  /** GC 通道：VACUUM；调用方需先停止运行中的写路径（见 `registerSessionGc`）。 */
  async vacuum(): Promise<void> {
    await this.ready;
    await this.backend.vacuum();
  }

  private async unarchiveBeforeDeletion(id: SessionId): Promise<void> {
    const registry = this.ctx.get("workspaceRegistry") as unknown as
      | {
          readonly archivedSessionIds: readonly SessionId[];
          unarchiveSession(sessionId: SessionId): Promise<void>;
        }
      | undefined;
    if (registry === undefined) return;
    if (!registry.archivedSessionIds.includes(id)) return;
    await registry.unarchiveSession(id);
  }

  async readRaw(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<
    | { meta: SessionHeader; inheritedEventCount: number; filename: string; content: string }
    | undefined
  > {
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    const log = await this.readLog(id, {}, signal);
    if (log === undefined) return undefined;
    repairReadView(log.events);
    // 整段日志导出：只丢弃「已不平衡」之后的尾部（尾部未闭合的 step 是中断运行的正常形状，由上游 resume 补 closers）
    const events = balanceRewindPrefix(log.events, { keepOpenTail: true });
    const inheritedEventCount = Math.min(log.inheritedEventCount, events.length);
    return {
      meta: log.meta,
      inheritedEventCount,

      filename: sessionFormatLogFilename(SESSION_FORMAT_VERSION),
      content: toJsonlArtifact(log.meta, inheritedEventCount, events),
    };
  }

  async materializeEmpty(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
  ): Promise<void> {
    await this.ready;
    await this.backend.transaction(async (tx) => {
      await tx.upsertSession({ meta, inheritedEventCount }, randomUUID());
      await tx.bumpRevision(meta.id);
    });
    this.tracker.materialized(meta.id);
    this.writeGuard.confirmHead(meta.id, -1);
  }

  async appendBatch(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
    tornTruncateTo?: number,
  ): Promise<boolean> {
    await this.ready;
    if (events.length === 0) return false;

    // 本仓库自造的事件类型落库前补上 `ignorable` 信封：不补的话上游那道校验连写入都拒。
    sealOwnEvents(events);
    validateStoredEvents(meta, [...events]);

    const reuse = this.reuseEventIds.get(meta.id);
    let confirmedHead = -1;
    // 本批用量行由 `appendEventTail` 折好；事务成功后旁路据此累加 token 汇总表。
    let usageRows: EventUsageRow[] = [];
    await this.backend.transaction(async (tx) => {
      if (tornTruncateTo !== undefined) {
        await tx.deleteBridgeTail(meta.id, tornTruncateTo);
        const prev = await tx.getPrevBridge(meta.id, tornTruncateTo - 1);
        if (prev === undefined) {
          await tx.updateHead(meta.id, "", -1);
        } else {
          await tx.updateHead(meta.id, prev.fEventId, prev.fSequence);
        }
      }
      await tx.upsertSession({ meta, inheritedEventCount }, randomUUID());
      const head = await tx.getHead(meta.id);

      this.writeGuard.assertNoConcurrentWriter(meta.id, head.fHeadSequence);
      const appended = await appendEventTail(
        tx,
        meta,
        events,
        { parentId: head.fHeadEventId, nextSeq: head.fHeadSequence + 1 },
        reuse,
      );
      usageRows = appended.usageRows;
      await tx.updateHead(meta.id, appended.headEventId, appended.headSequence);
      await tx.bumpRevision(meta.id, maxEventTime(events));
      confirmedHead = appended.headSequence;
    });
    // 事务**成功之后**才丢掉复用映射：失败（并发写者校验、唯一键冲突等）时这份映射还没被消费，
    // 重试同一个 append 还要靠它复用父会话的事件行——提前删掉会让前缀事件行被重新插入一遍。
    if (reuse !== undefined) this.reuseEventIds.delete(meta.id);

    this.writeGuard.confirmHead(meta.id, confirmedHead);
    this.tracker.materialized(meta.id);
    await this.recordSessionStats(meta.id, events, usageRows);
    return true;
  }

  async readLog(
    id: SessionId,
    options: { fromSeq?: number } = {},
    signal?: AbortSignal,
  ): Promise<
    | {
        meta: SessionHeader;

        inheritedEventCount: number;
        events: SessionEvent[];
        tornFrom?: number;

        incarnation: string;

        revision: number;

        storedCount: number;

        migrated: boolean;
      }
    | undefined
  > {
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    const row = await this.backend.getSession(id);
    if (row === undefined) return undefined;
    const meta = rowToMeta(row);
    const eventRows =
      options.fromSeq === undefined
        ? await this.backend.getEventRows(id)
        : await this.backend.getEventRows(id, options.fromSeq);
    signal?.throwIfAborted();

    if (isLegacyVersion(row.fVersion)) {
      try {
        const converted = convertLegacyRows(row, eventRows);
        return {
          meta: converted.meta,
          inheritedEventCount: converted.inheritedEventCount,
          events: converted.events,
          incarnation: row.fIncarnation,
          revision: row.fRevision,
          storedCount: eventRows.length,
          migrated: true,
        };
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `session-rdb: session "${id}" is not a single released format; adopting its stored rows as current-format data (${error instanceof Error ? error.message : String(error)})`,
        );
        const adopted = adoptLegacyRows(row, eventRows);
        return {
          meta: adopted.meta,
          inheritedEventCount: adopted.inheritedEventCount,
          events: adopted.events,
          incarnation: row.fIncarnation,
          revision: row.fRevision,
          storedCount: eventRows.length,
          migrated: false,
          ...(adopted.tornFrom !== undefined ? { tornFrom: adopted.tornFrom } : {}),
        };
      }
    }
    const { preserved, tornFrom } = scanRows(eventRows, options.fromSeq ?? 0);
    // 版本号不完全可信：写路径曾把回退视图的结果以当前版本号落库，于是库里存在「v4 标记 + 旧代形状」
    // 的行——在扫干净的边界之内再按内容判一次（撕裂尾部与坏行已经被 `scanRows` 丢掉了）。
    if (needsShapeAdoption(preserved)) {
      const adopted = adoptLegacyRows(row, eventRows);
      return {
        meta: adopted.meta,
        inheritedEventCount: adopted.inheritedEventCount,
        events: adopted.events,
        incarnation: row.fIncarnation,
        revision: row.fRevision,
        storedCount: eventRows.length,
        migrated: false,
        ...(adopted.tornFrom !== undefined ? { tornFrom: adopted.tornFrom } : {}),
      };
    }
    return {
      meta,
      inheritedEventCount: row.fSeedLength ?? 0,
      events: preserved,
      incarnation: row.fIncarnation,
      revision: row.fRevision,
      storedCount: eventRows.length,
      migrated: false,
      ...(tornFrom !== undefined ? { tornFrom } : {}),
    };
  }

  /**
   * 统计衍生表的**旁路累加**：不在写事务里、失败只 warn——两张会话汇总表都是可销毁重建的
   * 派生表，丢几次累加不影响可用性（需要时用 `rebuildSessionStats` 重算）。
   * token 走写路径已折好的用量行，活动计数走本批事件类型。
   */
  private async recordSessionStats(
    id: SessionId,
    events: readonly SessionEvent[],
    usageRows: readonly EventUsageRow[],
  ): Promise<void> {
    const usageBuckets = sessionUsageBuckets(usageRows);
    if (usageBuckets.length > 0) {
      try {
        await this.backend.incrementSessionUsage(id, usageBuckets);
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `session-rdb: token usage for "${id}" not updated (${describeError(error)})`,
        );
      }
    }
    const countBuckets = sessionCountBuckets(events);
    if (countBuckets.length > 0) {
      try {
        await this.backend.incrementSessionCounts(id, countBuckets);
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `session-rdb: activity counts for "${id}" not updated (${describeError(error)})`,
        );
      }
    }
  }

  /**
   * 重算一个会话的统计（rewind / fork 之后；best-effort，同 `recordSessionStats`）：
   * 两张汇总表按会话重算，用量行的引用标记全量重算（引用可能跨会话消失）。
   */
  async rebuildSessionStats(id: SessionId): Promise<void> {
    try {
      await this.backend.rebuildSessionStats(id);
      await this.backend.refreshEventUsageFlags();
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `session-rdb: session stats for "${id}" not rebuilt (${describeError(error)})`,
      );
    }
  }

  /** 会话删除时清掉它的汇总行，并重算用量行的引用标记（被删会话引用的行要立刻退出统计）。 */
  private async dropSessionStats(id: SessionId): Promise<void> {
    try {
      await this.backend.deleteSessionStats(id);
      await this.backend.refreshEventUsageFlags();
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `session-rdb: session stats for "${id}" not deleted (${describeError(error)})`,
      );
    }
  }

  private async rewriteMigratedLog(
    id: SessionId,
    log: { meta: SessionHeader; inheritedEventCount: number; events: SessionEvent[] },
  ): Promise<void> {
    await this.backend.transaction(async (tx) => {
      // 这段重写会删光该会话的桥接行、再按迁移视图重建——与 `appendBatch` 同一个理由，先做并发写者校验：
      // 否则另一实例在 open 之前 / 期间提交的事件会被这段重写静默丢掉。调用方刚读过这份日志（重写只发生在
      // write open 的读路径之后），所以 guard 里没有该会话时就把当前磁盘 head 记成本实例已确认的值；
      // 有记录时严格比较——那能抓住"读完之后另一个实例又写了"。
      const head = await tx.getHead(id);
      if (!this.writeGuard.has(id)) this.writeGuard.confirmHead(id, head.fHeadSequence);
      this.writeGuard.assertNoConcurrentWriter(id, head.fHeadSequence);
      await tx.deleteBridgeTail(id, 0);
      await tx.upsertSession(
        { meta: log.meta, inheritedEventCount: SessionLogOffset(log.inheritedEventCount) },
        randomUUID(),
      );
      const appended = await appendEventTail(tx, log.meta, log.events, {
        parentId: "",
        nextSeq: 0,
      });
      await tx.updateHead(id, appended.headEventId, appended.headSequence);
      await tx.bumpRevision(id, maxEventTime(log.events));
    });
    // 重写换了事件行：被删掉的那批成了孤儿（引用标记要落回 0），本会话汇总按新事件重算。
    await this.rebuildSessionStats(id);
  }

  async listSnapshots(
    signal?: AbortSignal,
  ): Promise<Array<SessionPersistenceSnapshot & { inheritedEventCount: number }>> {
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    const snapshots: Array<SessionPersistenceSnapshot & { inheritedEventCount: number }> = [];
    const listed = new Set<SessionId>();
    for (const [id, pending] of this.tracker.pendingEntries()) {
      snapshots.push({
        header: pending.header,
        revision: pending.revision,
        inheritedEventCount: pending.inheritedEventCount,
      });
      listed.add(id);
    }
    const rows = await this.backend.listSessions();
    signal?.throwIfAborted();
    for (const row of rows) {
      if (listed.has(row.fSessionId as SessionId)) continue;
      snapshots.push({
        header: rowToMeta(row),
        revision: this.rowRevision(row),
        inheritedEventCount: row.fSeedLength ?? 0,
      });
    }
    return snapshots;
  }

  async readStoredRevision(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceRevision | undefined> {
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    const row = await this.backend.getSession(id);
    if (row === undefined) return undefined;
    return this.rowRevision(row);
  }

  async createAndAppend(
    header: SessionHeader,
    events: readonly SessionEvent[],
    inheritedEventCount?: number,
  ): Promise<void> {
    const handle = await this.create(
      header,
      inheritedEventCount === undefined
        ? undefined
        : { inheritedEventCount: SessionLogOffset(inheritedEventCount) },
    );
    try {
      if (events.length > 0) await handle.append(events);
    } finally {
      await handle.close();
    }
  }

  async load(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<import("@deepseek-ai/dsh-session-persistence").SessionInspection> {
    signal?.throwIfAborted();
    await this.ready;
    signal?.throwIfAborted();
    // 一条读取路径：load 的语义就是「读一次完整快照」，不再经 handle 面再读一遍
    // （原先 open(read) 读一次 + handle.read 又读一次，等于把最贵的读付两遍）。
    const log = await this.readLog(id, {}, signal);
    if (log === undefined) {
      // 未落库的 live 会话没有磁盘视图：与 handle.read 的 detached 口径一致，返回空日志。
      const pending = this.tracker.pendingOf(id);
      if (pending !== undefined) {
        return {
          meta: pending.header,
          inheritedEventCount: SessionLogOffset(pending.inheritedEventCount),
          events: [],
        };
      }
      throw new SessionPersistenceNotFoundError(id);
    }
    repairReadView(log.events);
    validateStoredEvents(log.meta, log.events);
    return {
      meta: log.meta,
      inheritedEventCount: SessionLogOffset(log.inheritedEventCount),
      events: log.events,
    };
  }

  async append(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    const handle = await this.open(id, "write");
    try {
      await handle.append(events);
    } finally {
      await handle.close();
    }
  }

  async readFrom(
    id: SessionId,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{
    meta: SessionHeader;
    inheritedEventCount: number;
    events: readonly SessionEvent[];
  }> {
    const log = await this.readLog(id, { fromSeq }, signal);
    if (log === undefined) throw new SessionPersistenceNotFoundError(id);
    return {
      meta: log.meta,
      inheritedEventCount: log.inheritedEventCount,
      events: log.events,
    };
  }

  async close(): Promise<void> {
    await this.ready;
    await this.backend.close();
  }

  registerReuseEventIds(childId: SessionId, map: ReadonlyMap<number, string>): void {
    this.reuseEventIds.set(childId, new Map(map));
  }

  /** 丢弃一个还没被消费的复用映射（fork 失败时）：留着会让同一个 childId 之后的落写复用父会话的事件行。 */
  dropReuseEventIds(childId: SessionId): void {
    this.reuseEventIds.delete(childId);
  }

  internals(): SessionPersistenceRdbInternals {
    return {
      backend: this.backend,
      writeGuard: this.writeGuard,
      create: (meta, inheritedEventCount) =>
        this.create(
          meta,
          inheritedEventCount === undefined
            ? undefined
            : { inheritedEventCount: SessionLogOffset(inheritedEventCount) },
        ),
      append: (id, events) => this.append(id, events),
      load: (id) => this.load(id),
      inspect: (id, signal) => this.load(id, signal),
      readFrom: (id, fromSeq, signal) => this.readFrom(id, fromSeq, signal),
      listSnapshots: (signal) => this.listSnapshots(signal),
      readStoredRevision: (id, signal) => this.readStoredRevision(id, signal),
      registerReuseEventIds: (childId, map) => this.registerReuseEventIds(childId, map),
      dropReuseEventIds: (childId) => this.dropReuseEventIds(childId),
    };
  }

  private rowRevision(row: import("./backend.ts").SessionRow): SessionPersistenceRevision {
    return SessionPersistenceRevision(
      `${this.storeIdentity}:incarnation:${row.fIncarnation}:revision:${row.fRevision}`,
    );
  }

  private readonly liveFailures = new Map<SessionId, Error>();
  private readonly liveDropWarned = new Set<SessionId>();

  // live 会话的持久化初始化失败是**终态**（cwd / 继承前缀冲突、id 碰撞、后端打不开都不自愈）：
  // 记账一条 error、丢掉已缓冲的事件，之后该会话的事件不再进内存缓冲（否则表现为
  // 「聊了一整轮、重启后全丢，内存里还留一份无界副本」），flush 把失败抛回上游。
  private watchLiveReady(ctx: Context, session: Session, ready: Promise<void>): void {
    void ready.catch((error: unknown) => {
      const failure =
        error instanceof Error
          ? error
          : new Error(
              typeof error === "string" ? error : `live session "${session.id}" persistence failed`,
            );
      this.liveFailures.set(session.id, failure);
      this.liveBuffers.delete(session.id);
      ctx.logger.error(
        `session-rdb: live session "${session.id}" persistence unavailable (${failure.message}); its events will not be persisted`,
      );
    });
  }

  private installLiveRouting(ctx: Context): void {
    ctx.on("session/created", (session: Session) => {
      this.liveBuffers.set(session.id, []);
      const ready = this.ensureLiveHandle(session);
      this.liveReady.set(session.id, ready);
      this.watchLiveReady(ctx, session, ready);
    });

    for (const session of ctx.sessions.list()) {
      this.liveBuffers.set(session.id, []);
      const ready = this.ensureLiveHandle(session);
      this.liveReady.set(session.id, ready);
      this.watchLiveReady(ctx, session, ready);
    }
    ctx.on("session/event", (session: Session, event: SessionEvent) => {
      const handle = this.tracker.writerOf(session.id);
      if (handle !== undefined) {
        handle.enqueueLive(event, (error) => {
          ctx.logger.warn(
            `session-rdb: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`,
          );
        });
        return;
      }
      if (this.liveFailures.has(session.id)) {
        if (!this.liveDropWarned.has(session.id)) {
          this.liveDropWarned.add(session.id);
          ctx.logger.warn(
            `session-rdb: dropping events for live session "${session.id}" because persistence failed earlier`,
          );
        }
        return;
      }
      this.liveBuffers.get(session.id)?.push(structuredClone(event));
    });
    ctx.on("session/flush", (session: Session) => {
      const failure = this.liveFailures.get(session.id);
      if (failure !== undefined) return Promise.reject(failure);
      const handle = this.tracker.writerOf(session.id);
      if (handle === undefined) {
        const ready = this.liveReady.get(session.id);
        if (ready === undefined) return undefined;
        return ready.then(() => {
          const settled = this.tracker.writerOf(session.id);
          if (settled === undefined) return undefined;
          return settled.drainLive().then(() => settled.flush());
        });
      }
      return handle.drainLive().then(() => handle.flush());
    });
    ctx.on("session/disposed", (session: Session) => {
      const ready = this.liveReady.get(session.id);
      this.liveBuffers.delete(session.id);
      this.liveReady.delete(session.id);
      this.liveFailures.delete(session.id);
      this.liveDropWarned.delete(session.id);
      const closeHandle = (): void => {
        const handle = this.tracker.writerOf(session.id);
        if (handle === undefined) return;
        handle.close().catch((error: unknown) => {
          ctx.logger.warn(
            `session-rdb: final drain for session "${session.id}" failed: ${String(error)}`,
          );
        });
      };
      if (ready === undefined) {
        closeHandle();
        return;
      }

      void ready.then(closeHandle, closeHandle);
    });
    ctx.effect(
      () => async () => {
        await Promise.allSettled(this.liveReady.values());
        this.liveBuffers.clear();
        this.liveReady.clear();
        this.liveFailures.clear();
        this.liveDropWarned.clear();
        await this.tracker.closeAll();

        await this.close();
      },
      `${this.name} open handles`,
    );
  }

  private async ensureLiveHandle(session: Session): Promise<void> {
    const id = session.header.id;
    if (this.tracker.writerOf(id) !== undefined) return;
    await this.ready;
    const stored = await this.readLog(id, {});
    let handle: RdbSessionHandle;
    if (stored === undefined) {
      handle = (await this.create(session.header, {
        inheritedEventCount: session.inheritedEventCount,
      })) as RdbSessionHandle;
      const seed = session.snapshotEvents();
      if (seed.length > 0) await handle.append(seed);
    } else {
      if (stored.meta.cwd !== session.header.cwd) {
        throw new Error(
          `session "${id}" is already persisted at a different cwd (persisted: ${String(stored.meta.cwd)}, live: ${String(session.header.cwd)}) (id collision)`,
        );
      }
      if (stored.inheritedEventCount !== session.inheritedEventCount) {
        throw new Error(
          `session "${id}" is already persisted with a different inherited event count (id collision)`,
        );
      }
      assertVersion(stored.meta);

      repairReadView(stored.events);
      const seed = session.snapshotEvents();
      if (!seedCoversPrefix(seed, stored.events)) {
        throw new Error(
          `session "${id}" already has a persisted log on disk that does not match this live session (id collision)`,
        );
      }
      handle = (await this.open(id, "write")) as RdbSessionHandle;

      const suffix = seed.slice(stored.events.length);
      if (suffix.length > 0) await handle.append(suffix);
    }

    const buffered = this.liveBuffers.get(id);
    if (buffered !== undefined && buffered.length > 0) {
      this.liveBuffers.set(id, []);
      for (const event of buffered) {
        handle.enqueueLive(event, () => {});
      }
    }
  }
}

function seedCoversPrefix(seed: readonly SessionEvent[], prefix: readonly SessionEvent[]): boolean {
  return (
    prefix.length <= seed.length &&
    prefix.every((event, index) => {
      const seedEvent = seed[index];
      return seedEvent !== undefined && JSON.stringify(seedEvent) === JSON.stringify(event);
    })
  );
}

/** 一批事件折成活动计数的桶：只数四种类型，按本地日聚合成四项。 */
function sessionCountBuckets(events: readonly SessionEvent[]): SessionCountBucket[] {
  const counted = new Map<string, SessionCountBucket>();
  for (const event of events) {
    if (!(COUNTED_EVENT_TYPES as readonly string[]).includes(event.type)) continue;
    const day = localDayKey(event.time);
    const bucket = counted.get(day) ?? { day, turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };
    addActivityCount(bucket, event.type, 1);
    counted.set(day, bucket);
  }
  return [...counted.values()];
}

/** 一批用量行折成 token 桶：按「本地日 × 模型」聚合（模型未知落空串，与表口径一致）。 */
function sessionUsageBuckets(usageRows: readonly EventUsageRow[]): SessionUsageBucket[] {
  const counted = new Map<string, SessionUsageBucket>();
  for (const row of usageRows) {
    const provider = row.fProvider ?? "";
    const model = row.fModel ?? "";
    const key = `${row.fDay}#${provider}#${model}`;
    const bucket = counted.get(key) ?? {
      day: row.fDay,
      provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    };
    bucket.inputTokens += row.fInputTokens;
    bucket.outputTokens += row.fOutputTokens;
    bucket.cacheReadTokens += row.fCacheReadTokens;
    bucket.reasoningTokens += row.fReasoningTokens;
    bucket.totalTokens += row.fTotalTokens;
    counted.set(key, bucket);
  }
  return [...counted.values()];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function createBackend(config: Config): Backend {
  if (config.type === "sqlite") {
    return new SqliteBackend({
      path: config.path,
      journalMode: config.journalMode ?? "wal",
      busyTimeout: config.busyTimeout ?? DEFAULT_BUSY_TIMEOUT_MS,
    });
  }
  const pool = new Pool({ connectionString: config.connectionString });

  pool.on("error", () => {});
  const db = drizzlePg({ client: pool });
  const identityBase = [
    "postgres",
    pool.options.host ?? "localhost",
    String(pool.options.port ?? 5432),
    pool.options.database ?? "",
    config.schema ?? "public",
  ].join(":");
  return new PostgresBackend(db, {
    identityBase,
    schema: config.schema ?? "public",
    close: () => pool.end(),
  });
}

async function appendEventTail(
  tx: BackendTx,
  meta: SessionHeader,
  events: readonly SessionEvent[],
  anchor: { parentId: string; nextSeq: number },
  reuse?: ReadonlyMap<number, string>,
): Promise<{ headEventId: string; headSequence: number; usageRows: EventUsageRow[] }> {
  let parentId = anchor.parentId;
  let nextSeq = anchor.nextSeq;

  const eventRows: EventInsert[] = [];
  const usageRows: EventUsageRow[] = [];
  const bridgeRows: Array<{
    fSessionId: SessionId;
    fEventId: string;
    fSequence: number;
    fSurfaceOp: string | null;
  }> = [];
  for (const event of events) {
    const reusedId = reuse?.get(event.seq);
    const eventId = reusedId ?? randomUUID();
    if (reusedId === undefined) {
      const { kind, role, name, actionId } = eventDimensions(event);

      const raw = event as SessionEvent & {
        ignorable?: unknown;
        surfaceOp?: unknown;
        sourceEventSeqs?: unknown;
      };
      const { data, surfaceOp: _surfaceOp, sourceEventSeqs: _sourceEventSeqs, ...envelope } = raw;
      const row: EventInsert = {
        fEventId: eventId,
        fParentId: parentId,
        fType: event.type,
        fKind: kind,
        fRole: role,
        fName: name,
        fActionId: actionId,
        fEncoding: EVENT_ENCODING,
        fData: JSON.stringify({ ...envelope, data }),
        fCreatedAt: event.time,
      };
      eventRows.push(row);
      // 用量行在这里一次折好（读侧维度一起物化），后端只负责插入，事务后旁路再据此累加汇总表。
      const usageRow = usageRowOf(row, meta.origin === "subagent");
      if (usageRow !== undefined) usageRows.push(usageRow);
    }
    const surfaceOp =
      (event as SessionEvent<SurfaceEventType>).surfaceOp === undefined
        ? null
        : JSON.stringify((event as SessionEvent<SurfaceEventType>).surfaceOp);
    bridgeRows.push({
      fSessionId: meta.id,
      fEventId: eventId,
      fSequence: nextSeq,
      fSurfaceOp: surfaceOp,
    });
    parentId = eventId;
    nextSeq++;
  }
  if (eventRows.length > 0) await tx.insertEvents(eventRows, usageRows);
  await tx.insertBridges(bridgeRows);

  if (events.some((event) => (event.type as string) === "session/title")) {
    await tx.refreshTitle(meta.id);
  }
  return { headEventId: parentId, headSequence: nextSeq - 1, usageRows };
}

export default SessionPersistenceRdb;
