// RDB 会话落盘：`sessionPersistence` 契约的替换实现（替换官方 jsonl），同时提供分支与管理面的行级能力。
//
// 上游契约的口径是 handle 模型（`create` / `open` / `flush` / `stat` / `list`）；分支与管理面要的是行级
// 读写，所以同一个实例再实现一份 `SessionRdbStore` 的能力面（`asRdbStore` 探测）。
import { join } from "node:path";
import {
  SESSION_FORMAT_VERSION,
  SessionId as toSessionId,
  SessionLogOffset,
} from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader, SessionId } from "@morlay/dsh-session/contract";
import {
  SessionAlreadyExistsError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from "@morlay/dsh-session-persistence/contract";
import type { Condition } from "@morlay/zephyr-rdb";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { AppEnv } from "@morlay/zephyr-app";
import {
  inject,
  Injectable,
  Logger,
  type Context,
  type OnInit,
  type OnDispose,
} from "@morlay/zephyr";
// 会话域事件由 `@morlay/dsh-session` 提供（一份权威定义，不各自再定义——签名分叉只会在运行期露出来）。
import { Events as SessionEvents } from "@morlay/dsh-session";

const { SessionCreated, SessionEventAppended, SessionFlush, SessionDisposed } = SessionEvents;
import { SessionStore } from "@morlay/dsh-session";
import { SessionAgentControl } from "./contract/session-agent-control.contract.ts";
import type { SessionArchiveRegistry } from "./contract/session-archive-registry.contract.ts";
import type {
  SessionRdbStore,
  SessionRowsPage,
  SessionUsageAggregate,
} from "./contract/session-rdb-store.contract.ts";
import type { BranchPort } from "./rdb/branch/port.ts";
import type { Backend, EventRow, SessionRow } from "./rdb/backend.ts";
import type { EventFilterColumns, SessionFilterColumns } from "./rdb/query-filters.ts";
import { RdbBackendTracker, RdbSessionHandle } from "./rdb/handles.ts";
import type { RdbLogView, RdbStoreHost } from "./rdb/host.ts";
import { LiveRouting } from "./rdb/live-routing.ts";
import { createReadPath } from "./rdb/read-path.ts";
import { createWritePath } from "./rdb/write-path.ts";
import { WriteGuard } from "./rdb/write-guard.ts";
import { openRdbBackend, type BackendConfig } from "./rdb/db/open.ts";
import { repairReadView } from "./rdb/log/repair.ts";
import { rowToMeta } from "./rdb/log/rows.ts";
import { DEFAULT_BUSY_TIMEOUT_MS, type JournalMode } from "./rdb/version.ts";
import { importZipIntoStore, type ImportHandle, type ImportHost } from "./rdb/log-import.ts";
import { SessionDeletionError } from "./rdb/deletion-error.ts";
import type { ReadModel } from "./rdb/backend.ts";

// 行配置：两个方言二选一；sqlite 的 `path` 省略时落到 `<dataDir>/sessions/sessions.sqlite`。
//
// 目录那一层与官方 jsonl 实现对齐（它落 `dataDir/sessions/`）：会话数据统一在 `sessions/` 下，
// 换实现时是"同一个目录里换个文件"，不是"数据从目录里挪到顶层"。
export type RdbConfig =
  | {
      readonly type: "sqlite";
      readonly path?: string | undefined;
      readonly journalMode?: JournalMode | undefined;
      readonly busyTimeout?: number | undefined;
      // 冷会话观察缓存容量（条数，最小 1）：每个条目持一份完整日志，越小越不放大内存。
      readonly preparedSessionCacheSize?: number | undefined;
    }
  | {
      readonly type: "postgres";
      readonly connectionString: string;
      readonly schema?: string | undefined;
      readonly preparedSessionCacheSize?: number | undefined;
    };

const DEFAULT_CONFIG: RdbConfig = { type: "sqlite" };

@Injectable()
export class SessionPersistenceRdb
  extends SessionPersistence
  implements SessionRdbStore, OnInit, OnDispose
{
  // 行配置由装配层的 `configure` 覆盖；缺省是 dataDir 下的 sqlite 文件。
  static readonly Config = (input: RdbConfig = DEFAULT_CONFIG): RdbConfig => input;

  // `bootstrapApplication` 按 `Config` 规范化后**从构造参数**交给实例：不接这个参数，`configure` 就静默无效。
  constructor(readonly rowConfig: RdbConfig = DEFAULT_CONFIG) {
    super();
  }

  readonly identity: symbol = Symbol("sessionPersistence");

  private readonly appEnv = inject(AppEnv);

  private readonly sessions = inject(SessionStore);

  private readonly agents = inject.optional(SessionAgentControl);

  private readonly logger = inject(Logger);

  // 会话的生命周期事件：挂在字段上，装配时由框架接上本行 ctx。
  readonly created$ = new SessionCreated();

  readonly event$ = new SessionEventAppended();

  readonly flush$ = new SessionFlush();

  readonly disposed$ = new SessionDisposed();

  private readonly tracker = new RdbBackendTracker("session-rdb");

  private readonly writeGuardState = new WriteGuard();

  private readonly reuseEventIds = new Map<SessionId, Map<number, string>>();

  private backendState: Backend | undefined;

  private storeIdentity = "";

  private liveRouting: LiveRouting | undefined;

  private readPathState: ReturnType<typeof createReadPath> | undefined;

  private writePathState: ReturnType<typeof createWritePath> | undefined;

  private config: RdbConfig = DEFAULT_CONFIG;

  private archiveState: SessionArchiveRegistry | undefined;

  private opened: Promise<void> = Promise.resolve();

  private host: RdbStoreHost | undefined;

  get ready(): Promise<void> {
    return this.opened;
  }

  // 冷会话观察缓存容量（源包同名字段：查询行按它建缓存）。
  get preparedSessionCacheSize(): number {
    return this.config.preparedSessionCacheSize ?? 1;
  }

  async onInit(ctx: Context): Promise<void> {
    this.config = this.rowConfig;
    // 归档面是可选能力：装配里没有它时，列表退回持久化里的归档标记，删除不做「先取消归档」。
    this.archiveState = (ctx as unknown as { get(name: string, strict?: boolean): unknown }).get(
      "sessionArchiveRegistry",
      false,
    ) as SessionArchiveRegistry | undefined;

    const host: RdbStoreHost = {
      tracker: this.tracker,
      readLog: (id, options, signal) => this.readLog(id, options, signal),
      materializeEmpty: (meta, inherited) => this.materializeEmpty(meta, inherited),
      appendBatch: (meta, inherited, events, torn) =>
        this.appendBatch(meta, inherited, events, torn),
    };
    this.host = host;
    // 后端的打开从 onInit 就开始，但**不在这里等完**：身份不符 / 版本不符要由**第一次读**报出来。
    // 判据是"坏库不该让装配失败"——装配失败等于整个宿主起不来，而这个库只是其中一行。
    // 挂一个空的 `catch` 防止打开失败变成未处理拒绝：真正的失败会原样抛给每个 `await opened` 的读。
    this.opened = this.openBackend();
    void this.opened.catch(() => undefined);
    this.readPathState = createReadPath({
      ready: this.opened,
      backend: () => this.backendOf(),
      tracker: this.tracker,
      logger: { warn: (message) => this.logger.warn(message) },
      revisionOf: (row) => this.rowRevision(row),
    });
    this.writePathState = createWritePath({
      ready: this.opened,
      backend: () => this.backendOf(),
      tracker: this.tracker,
      writeGuard: this.writeGuardState,
      reuseEventIds: this.reuseEventIds,
      logger: { warn: (message) => this.logger.warn(message) },
      readLog: async (id) => {
        const log = await this.readLog(id, {});
        return log === undefined
          ? undefined
          : { meta: log.meta, inheritedEventCount: log.inheritedEventCount, events: log.events };
      },
    });
    this.liveRouting = new LiveRouting({
      host,
      events: {
        onCreated: (listener) => this.created$.on(listener),
        onEvent: (listener) => this.event$.on(listener),
        onFlush: (listener) => this.flush$.on(listener),
        onDisposed: (listener) => this.disposed$.on(listener),
      },
      assertVersion: (meta) => {
        if (meta.version !== SESSION_FORMAT_VERSION) {
          throw new Error(
            `session is stored in format v${String(meta.version)}, this build reads v${String(SESSION_FORMAT_VERSION)}`,
          );
        }
      },
      readLog: (id) => this.readLog(id, {}),
      sessions: () => this.sessions.list(),
      create: (header, inherited) =>
        this.create(header, { inheritedEventCount: SessionLogOffset(Number(inherited)) }),
      openWrite: (id) => this.open(id, "write"),
      warn: (message) => this.logger.warn(message),
      error: (message) => this.logger.error(message),
      close: () => this.shutdown(),
    });
    this.liveRouting.install();
  }

  async onDispose(): Promise<void> {
    await this.liveRouting?.shutdown();
  }

  // storage 接管要的库句柄：等后端打开，再把它的 storage 面交出去。
  async storageRepository(): Promise<import("./rdb/storage-takeover/types.ts").StorageRepository> {
    await this.opened;
    return this.backendOf().storage;
  }

  // —— 内部访问器（测试与分支/管理面用）——
  // 打开后的后端：read-path / branch 的用例读 `backend.reads` 观测"读了几次事件行"。
  get backend(): Backend {
    return this.backendOf();
  }

  // 写者位点守卫：分支的 rewind 与写路径共用（测试用它造并发写者的前态）。
  get writeGuard(): WriteGuard {
    return this.writeGuardState;
  }

  // 读面：条件查询（筛选下推到 SQL 用）。要等后端打开——没打开时调用会抛"还没打开"，那是装配错误。
  readModel(): ReadModel {
    return this.backendOf().reads;
  }

  // 筛选下推的列引用（取表在 read-model，这里只转发）。
  sessionFilterColumns(): SessionFilterColumns {
    return this.readModel().columns.session;
  }

  eventFilterColumns(): EventFilterColumns {
    return this.readModel().columns.event;
  }

  selectSessionRows(condition?: Condition): Promise<SessionRow[]> {
    return this.readModel().selectSessionRows(condition);
  }

  selectEventRows(id: string, condition?: Condition): Promise<EventRow[]> {
    return this.readModel().selectEventRows(id, condition);
  }

  // 会话行 → header + 继承前缀长度：只读会话行，**不读日志**（`load` 会把整段事件拉回来）。
  async headerOf(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ header: SessionHeader; inheritedEventCount: number } | undefined> {
    signal?.throwIfAborted();
    await this.opened;
    signal?.throwIfAborted();
    const row = await this.readModel().getSession(id);
    if (row === undefined) return undefined;
    return { header: rowToMeta(row), inheritedEventCount: row.fSeedLength ?? 0 };
  }

  // 快照列表（含继承前缀账目）：源 spec 的 branch 用例比对 fork 前后的前缀。
  listSnapshots(signal?: AbortSignal) {
    return this.readPath().listSnapshots(signal);
  }

  // 已存储的 revision：源 spec 的 branch 用例断言 rewind 之后 revision 变了。
  readStoredRevision(id: SessionId, signal?: AbortSignal) {
    return this.readPath().readStoredRevision(id, signal);
  }

  // 契约的 close：关句柄、关后端（卸载时也走它）。
  async close(): Promise<void> {
    await this.shutdown();
  }

  private backendOf(): Backend {
    if (this.backendState === undefined) throw new Error("session-rdb: backend 还没打开");
    return this.backendState;
  }

  private readPath(): ReturnType<typeof createReadPath> {
    if (this.readPathState === undefined) throw new Error("session-rdb: 读路径还没装配");
    return this.readPathState;
  }

  private writePath(): ReturnType<typeof createWritePath> {
    if (this.writePathState === undefined) throw new Error("session-rdb: 写路径还没装配");
    return this.writePathState;
  }

  private async openBackend(): Promise<void> {
    this.backendState = await openRdbBackend(this.backendConfig());
    await this.backendState.open();
    this.storeIdentity = this.backendState.storeIdentity;
  }

  private backendConfig(): BackendConfig {
    if (this.config.type === "postgres") {
      return {
        type: "postgres",
        connectionString: this.config.connectionString,
        ...(this.config.schema === undefined ? {} : { schema: this.config.schema }),
      };
    }
    return {
      type: "sqlite",
      path: this.config.path ?? join(this.appEnv.values.dataDir, "sessions", "sessions.sqlite"),
      journalMode: this.config.journalMode ?? "wal",
      busyTimeout: this.config.busyTimeout ?? DEFAULT_BUSY_TIMEOUT_MS,
    };
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
    await this.opened;
    options?.signal?.throwIfAborted();
    if (
      this.tracker.hasPending(snapshot.id) ||
      (await this.backendOf().reads.getSession(snapshot.id)) !== undefined
    ) {
      throw new SessionAlreadyExistsError(snapshot.id);
    }
    this.tracker.registerCreated(snapshot, inheritedEventCount);
    return this.tracker.adopt(
      new RdbSessionHandle(this.hostOf(), snapshot.id, snapshot, "write", {
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
    await this.opened;
    options?.signal?.throwIfAborted();
    const pending = this.tracker.pendingOf(id);
    if (access === "read") {
      if (pending !== undefined) {
        return this.tracker.adopt(
          new RdbSessionHandle(this.hostOf(), id, pending.header, "read", {
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
        new RdbSessionHandle(this.hostOf(), id, log.meta, "read", {
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
          new RdbSessionHandle(this.hostOf(), id, pending.header, "write", {
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
        await this.writePath().rewriteMigratedLog(id, log);
      }
      this.writeGuardState.confirmHead(id, log.events.at(-1)?.seq ?? -1);
      return this.tracker.adopt(
        new RdbSessionHandle(this.hostOf(), id, log.meta, "write", {
          cursor: log.events.length,
          materialized: true,
          inheritedEventCount: SessionLogOffset(log.inheritedEventCount),
          ...(log.tornFrom === undefined ? {} : { tornTruncateTo: log.tornFrom }),
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
    await this.opened;
    options?.signal?.throwIfAborted();
    const pending = this.tracker.pendingOf(id);
    if (pending !== undefined) return { header: pending.header, revision: pending.revision };
    const row = await this.backendOf().reads.getSession(id);
    if (row === undefined) return undefined;
    return { header: rowToMeta(row), revision: this.rowRevision(row) };
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
    await this.opened;
    signal?.throwIfAborted();
    for (const row of await this.backendOf().reads.listSessions()) {
      if (listed.has(toSessionId(row.fSessionId))) continue;
      snapshots.push({ header: rowToMeta(row), revision: this.rowRevision(row) });
    }
    return snapshots;
  }

  async readRawEvents(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
    const sessionId = toSessionId(id);
    const log = await this.readLog(sessionId, {}, signal);
    if (log === undefined) throw new SessionPersistenceNotFoundError(sessionId);
    return { meta: log.meta, events: log.events };
  }

  async readRaw(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ inheritedEventCount: number; filename: string; content: string } | undefined> {
    return await this.readPath().readRaw(toSessionId(id), signal);
  }

  async load(
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    meta: SessionHeader;
    inheritedEventCount: number;
    events: readonly SessionEvent[];
  }> {
    const sessionId = toSessionId(id);
    signal?.throwIfAborted();
    await this.opened;
    signal?.throwIfAborted();
    const log = await this.readLog(sessionId, {}, signal);
    if (log === undefined) {
      // 未落库的 live 会话没有磁盘视图：与 handle.read 的 detached 口径一致，返回空日志。
      const pending = this.tracker.pendingOf(sessionId);
      if (pending === undefined) throw new SessionPersistenceNotFoundError(sessionId);
      return {
        meta: pending.header,
        inheritedEventCount: pending.inheritedEventCount,
        events: [],
      };
    }
    repairReadView(log.events);
    validateStoredEvents(log.meta, log.events);
    return {
      meta: log.meta,
      inheritedEventCount: log.inheritedEventCount,
      events: log.events,
    };
  }

  async readFrom(
    id: string,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{
    meta: SessionHeader;
    inheritedEventCount: number;
    events: readonly SessionEvent[];
  }> {
    const sessionId = toSessionId(id);
    const log = await this.readLog(sessionId, { fromSeq }, signal);
    if (log === undefined) throw new SessionPersistenceNotFoundError(sessionId);
    return {
      meta: log.meta,
      inheritedEventCount: log.inheritedEventCount,
      events: log.events,
    };
  }

  async append(id: string, events: readonly SessionEvent[]): Promise<void> {
    const handle = await this.open(toSessionId(id), "write");
    try {
      await handle.append(events);
    } finally {
      await handle.close();
    }
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

  async listRows(query: {
    query?: string;
    includeSubagents?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<SessionRowsPage> {
    await this.opened;
    const page = await this.backendOf().listSessionRows({ ...query });
    return { items: page.items, total: page.total };
  }

  async deleteSession(id: string, signal?: AbortSignal): Promise<void> {
    const sessionId = toSessionId(id);
    signal?.throwIfAborted();
    await this.opened;
    signal?.throwIfAborted();
    const row = await this.backendOf().reads.getSession(sessionId);
    if (row === undefined) {
      throw new SessionDeletionError(`session "${id}" not found`, "SESSION_NOT_FOUND");
    }
    if (row.fArchivedAt === null) {
      throw new SessionDeletionError(
        `session "${id}" is not archived; only archived sessions can be deleted`,
        "SESSION_NOT_ARCHIVED",
      );
    }
    if (this.tracker.hasPending(sessionId) || this.tracker.hasOpenHandle(sessionId)) {
      throw new SessionDeletionError(
        `session "${id}" is live; stop it before deleting`,
        "SESSION_LIVE",
      );
    }
    await this.unarchiveBeforeDeletion(sessionId);
    const referenced = await this.backendOf().transaction((tx) => tx.deleteSession(sessionId));
    this.liveRouting?.forget(sessionId);
    this.reuseEventIds.delete(sessionId);
    await this.writePath().dropSessionStats(sessionId);
    await this.writePath().refreshEventUsageFlags(referenced);
  }

  async importZip(zip: Uint8Array, targetId?: string): Promise<string> {
    await this.opened;
    const host: ImportHost = {
      create: (header, inherited) =>
        this.create(header, {
          inheritedEventCount: SessionLogOffset(inherited),
        }) as unknown as Promise<ImportHandle>,
      open: (id, access) => this.open(id, access) as unknown as Promise<ImportHandle>,
      writerOf: (id) => this.tracker.writerOf(id) as unknown as ImportHandle | undefined,
      rewind: async (id) => {
        await this.backendOf().transaction(async (tx) => {
          await tx.deleteBridgeTail(id, 0);
          await tx.updateHead(id, "", -1);
          await tx.bumpRevision(id);
        });
        this.writeGuardState.confirmHead(id, -1);
        this.tracker.writerOf(id)?.resetAfterRewind(0, 0);
      },
      resetLiveDerivedState: (session) => this.resetLiveDerivedState(session),
      sessions: { get: (id) => this.sessions.get(id) },
      stopLoop: (id) => this.stopAgent(id),
    };
    return await importZipIntoStore(
      host,
      zip,
      targetId === undefined ? undefined : toSessionId(targetId),
    );
  }

  async organize(): Promise<{
    orphanSessions: number;
    orphanEvents: number;
    rebuiltSessions: number;
  }> {
    await this.opened;
    const orphanSessions = await this.collectOrphanSessions();
    const orphanEvents = await this.backendOf().collectOrphans();
    const rebuiltSessions = await this.backendOf().rebuildAllStats();
    await this.backendOf().vacuum();
    return { orphanSessions, orphanEvents, rebuiltSessions };
  }

  async collectOrphanSessions(): Promise<number> {
    await this.opened;
    const orphans = await this.backendOf().listOrphanSubagentSessions();
    const deletable = orphans.filter(
      (id) => !this.tracker.hasPending(id) && !this.tracker.hasOpenHandle(id),
    );
    if (deletable.length === 0) return 0;
    const { deleted, eventIds } = await this.backendOf().transaction((tx) =>
      tx.deleteSessions(deletable),
    );
    for (const id of deletable) {
      this.liveRouting?.forget(id);
      this.reuseEventIds.delete(id);
      await this.writePath().dropSessionStats(id);
    }
    await this.writePath().refreshEventUsageFlags(eventIds);
    return deleted;
  }

  async usageReport(sinceMs?: number): Promise<SessionUsageAggregate> {
    await this.opened;
    return (await this.backendOf().usageReport(sinceMs)) as unknown as SessionUsageAggregate;
  }

  async vacuum(): Promise<void> {
    await this.opened;
    await this.backendOf().vacuum();
  }

  async archivedSessionIds(): Promise<ReadonlySet<string>> {
    await this.opened;
    const state = (await this.backendOf().storage.readDomainGlobal("workspace")) as {
      archivedSessionIds?: readonly string[];
    } | null;
    return new Set((state?.archivedSessionIds ?? []).map(String));
  }

  branchPort(): BranchPort {
    return {
      ready: this.opened,
      readLog: (id, options, signal) => this.readLog(id, options ?? {}, signal),
      create: (meta, options) => this.create(meta, options),
      eventRows: (id, fromSequence) => this.backendOf().reads.getEventRows(id, fromSequence),
      eventTypesBefore: (id, before, limit) =>
        this.backendOf().reads.getEventTypesBefore(id, before, limit),
      sessionRow: (id) => this.backendOf().reads.getSession(id),
      eventTypeAt: (id, sequence) => this.backendOf().reads.getEventTypeAt(id, sequence),
      transaction: (fn) => this.backendOf().transaction(fn),
      confirmHead: (id, sequence) => this.writeGuardState.confirmHead(id, sequence),
      readStoredRevision: (id) => this.readPath().readStoredRevision(id),
      registerReuseEventIds: (childId, map) => this.registerReuseEventIds(childId, map),
      dropReuseEventIds: (childId) => this.dropReuseEventIds(childId),
      resetWriterAfterRewind: (id, cursor, inheritedEventCount) => {
        this.tracker.writerOf(id)?.resetAfterRewind(cursor, inheritedEventCount);
      },
    };
  }

  registerReuseEventIds(childId: SessionId, map: ReadonlyMap<number, string>): void {
    this.reuseEventIds.set(childId, new Map(map));
  }

  dropReuseEventIds(childId: SessionId): void {
    this.reuseEventIds.delete(childId);
  }

  // 覆盖导入等整段替换内存 log 的路径要复用 rewind 的失效钩子；钩子的实现在分支行（它读投影与 token-meter）。
  resetLiveDerivedState(session: unknown): void {
    void session;
  }

  readLog(
    id: SessionId,
    options: { fromSeq?: number } = {},
    signal?: AbortSignal,
  ): Promise<RdbLogView | undefined> {
    return this.readPath().readLog(id, options, signal);
  }

  materializeEmpty(meta: SessionHeader, inheritedEventCount: SessionLogOffset): Promise<void> {
    return this.writePath().materializeEmpty(meta, inheritedEventCount);
  }

  appendBatch(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
    tornTruncateTo?: number,
  ): Promise<boolean> {
    return this.writePath().appendBatch(meta, inheritedEventCount, events, tornTruncateTo);
  }

  private hostOf(): RdbStoreHost {
    if (this.host === undefined) throw new Error("session-rdb: 宿主端口还没装配");
    return this.host;
  }

  private async stopAgent(id: SessionId): Promise<void> {
    const agent = this.agents?.get(id);
    if (agent === undefined) return;
    agent.cancel?.({ kind: "user" }, { keepInbox: true });
    await agent.whenIdle();
  }

  private async unarchiveBeforeDeletion(id: SessionId): Promise<void> {
    if (this.archiveState === undefined) return;
    if (!this.archiveState.archivedSessionIds.includes(id)) return;
    await this.archiveState.unarchiveSession(id);
  }

  private async shutdown(): Promise<void> {
    await this.opened.catch(() => undefined);
    await this.tracker.closeAll();
    if (this.backendState !== undefined) await this.backendState.close();
  }

  private rowRevision(row: SessionRow): SessionPersistenceRevision {
    return SessionPersistenceRevision(
      `${this.storeIdentity}:incarnation:${row.fIncarnation}:revision:${row.fRevision}`,
    );
  }
}
