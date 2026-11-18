// 数据面的持久化核心：后端生命周期、读 / 写路径装配、handle 模型与日志入口的接线。
//
// 门面（admin/store.ts）继承它，只加管理面（查询 / 导入导出 / 运维 / 分支端口）。
import { join } from "node:path";
import {
  SESSION_FORMAT_VERSION,
  SessionId as toSessionId,
  SessionLogOffset,
} from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader, SessionId } from "@morlay/dsh-session/contract";
import {
  SessionPersistenceRevision,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceStatOptions,
} from "@morlay/dsh-session-persistence/contract";
import type { Condition } from "@morlay/zephyr-rdb";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { AppEnv } from "@morlay/zephyr-app";
import { inject, Logger } from "@morlay/zephyr";
import { Events as SessionEvents, SessionStore } from "@morlay/dsh-session";
import type { Backend, EventRow, SessionRow } from "../backend.ts";
import type {
  EventFilterColumns,
  SessionFilterColumns,
} from "../../contract/data-shapes.contract.ts";
import { RdbBackendTracker } from "./handles.ts";
import type { RdbLogView, RdbStoreHost } from "./host.ts";
import { LiveRouting } from "./live-routing.ts";
import { createReadPath } from "./read-path.ts";
import { createWritePath } from "./write-path.ts";
import { WriteGuard } from "../write-guard.ts";
import { openRdbBackend, type BackendConfig } from "./open.ts";
import { DEFAULT_BUSY_TIMEOUT_MS } from "../version.ts";
import type { JournalMode } from "../version.ts";
import { createHandleModel } from "./handle-model.ts";
import { createLogEntries } from "./log-entries.ts";
import type { StorePorts } from "./store-ports.ts";
import type { ReadModel } from "../backend.ts";

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

export const DEFAULT_CONFIG: RdbConfig = { type: "sqlite" };

const { SessionCreated, SessionEventAppended, SessionFlush, SessionDisposed } = SessionEvents;

/** 会话落盘的数据面核心（装配 + 契约转发）。 */
export abstract class RdbPersistenceCore extends SessionPersistence {
  constructor(readonly rowConfig: RdbConfig = DEFAULT_CONFIG) {
    super();
  }

  readonly identity: symbol = Symbol("sessionPersistence");

  private readonly appEnv = inject(AppEnv);

  protected readonly sessions = inject(SessionStore);

  protected readonly logger = inject(Logger);

  // 会话的生命周期事件：挂在字段上，装配时由框架接上本行 ctx。
  readonly created$ = new SessionCreated();

  readonly event$ = new SessionEventAppended();

  readonly flush$ = new SessionFlush();

  readonly disposed$ = new SessionDisposed();

  protected readonly tracker = new RdbBackendTracker("session-rdb");

  protected readonly writeGuardState = new WriteGuard();

  protected readonly reuseEventIds = new Map<SessionId, Map<number, string>>();

  protected backendState: Backend | undefined;

  private storeIdentity = "";

  protected liveRouting: LiveRouting | undefined;

  protected readPathState: ReturnType<typeof createReadPath> | undefined;

  protected writePathState: ReturnType<typeof createWritePath> | undefined;

  protected config: RdbConfig = DEFAULT_CONFIG;

  protected opened: Promise<void> = Promise.resolve();

  private host: RdbStoreHost | undefined;

  get ready(): Promise<void> {
    return this.opened;
  }

  // 冷会话观察缓存容量（源包同名字段：查询行按它建缓存）。
  get preparedSessionCacheSize(): number {
    return this.config.preparedSessionCacheSize ?? 1;
  }

  // 数据面端口：门面把这些入口交给 handle 模型 / 日志入口 / 运维动作（它们不认识本类）。
  private readonly ports: StorePorts = {
    ready: () => this.opened,
    backend: () => this.backendOf(),
    readPath: () => this.readPath(),
    writePath: () => this.writePath(),
    host: () => this.hostOf(),
    tracker: this.tracker,
    writeGuard: this.writeGuardState,
    drainLiveWrites: () => this.drainLiveWrites(),
    revisionOf: (row) => this.rowRevision(row),
  };

  private readonly handles = createHandleModel(this.ports);

  private readonly logEntries = createLogEntries(this.ports);

  /** 装配宿主端口、打开后端、接上读 / 写路径（onInit 里调用；打开不等完）。 */
  protected startPaths(): void {
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
  }

  /** 接上 live 路由（四个生命周期事件 + 现场写句柄）。 */
  protected installLiveRouting(): void {
    this.liveRouting = new LiveRouting({
      host: this.hostOf(),
      events: {
        onCreated: (listener) => this.created$.on(listener),
        onEvent: (listener) => this.event$.on(listener),
        onFlush: (listener) => this.flush$.on(listener),
        onDisposed: (listener) => this.disposed$.on(listener),
      },
      hasStoredRow: async (id) => {
        // 与读路径同一前提：后端打开之后才知道库里有没有这一行。
        await this.opened;
        return (await this.backendOf().reads.getSession(id)) !== undefined;
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

  // storage 接管要的库句柄：等后端打开，再把它的 storage 面交出去。
  async storageRepository(): Promise<import("@morlay/better-session/contract").StorageRepository> {
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

  // 契约的 close：关句柄、关后端（卸载时也走它）。
  async close(): Promise<void> {
    await this.shutdown();
  }

  // 契约转发：实现体在 handle 模型与日志入口里（它们只认端口，不认识本类）。
  create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    return this.handles.create(header, options);
  }

  open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions) {
    return this.handles.open(id, access, options);
  }

  stat(id: SessionId, options?: SessionPersistenceStatOptions) {
    return this.handles.stat(id, options);
  }

  list(options?: SessionPersistenceListOptions) {
    return this.handles.list(options);
  }

  headerOf(id: string, signal?: AbortSignal) {
    return this.handles.headerOf(id, signal);
  }

  listSnapshots(signal?: AbortSignal) {
    return this.handles.listSnapshots(signal);
  }

  readStoredRevision(id: SessionId, signal?: AbortSignal) {
    return this.handles.readStoredRevision(id, signal);
  }

  flush(): Promise<void> {
    return this.logEntries.flush();
  }

  load(id: string, signal?: AbortSignal) {
    return this.logEntries.load(id, signal);
  }

  readFrom(id: string, fromSeq: number, signal?: AbortSignal) {
    return this.logEntries.readFrom(id, fromSeq, signal);
  }

  readRaw(id: string, signal?: AbortSignal) {
    return this.logEntries.readRaw(id, signal);
  }

  readRawEvents(id: string, signal?: AbortSignal) {
    return this.logEntries.readRawEvents(id, signal);
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

  protected async openBackend(): Promise<void> {
    this.backendState = await openRdbBackend(this.backendConfig());
    await this.backendState.open();
    this.storeIdentity = this.backendState.storeIdentity;
  }

  protected backendConfig(): BackendConfig {
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

  protected async drainLiveWrites(): Promise<unknown[]> {
    const failures: unknown[] = [];
    for (const session of this.sessions.list()) {
      try {
        await this.sessions.flush(session);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    try {
      await this.tracker.flushAll();
    } catch (error: unknown) {
      failures.push(...(error instanceof AggregateError ? error.errors : [error]));
    }
    return failures;
  }

  protected backendOf(): Backend {
    if (this.backendState === undefined) throw new Error("session-rdb: backend 还没打开");
    return this.backendState;
  }

  protected readPath(): ReturnType<typeof createReadPath> {
    if (this.readPathState === undefined) throw new Error("session-rdb: 读路径还没装配");
    return this.readPathState;
  }

  protected writePath(): ReturnType<typeof createWritePath> {
    if (this.writePathState === undefined) throw new Error("session-rdb: 写路径还没装配");
    return this.writePathState;
  }

  protected hostOf(): RdbStoreHost {
    if (this.host === undefined) throw new Error("session-rdb: 宿主端口还没装配");
    return this.host;
  }

  protected async shutdown(): Promise<void> {
    await this.opened.catch(() => undefined);
    await this.tracker.closeAll();
    if (this.backendState !== undefined) await this.backendState.close();
  }

  protected rowRevision(row: SessionRow): SessionPersistenceRevision {
    return SessionPersistenceRevision(
      `${this.storeIdentity}:incarnation:${row.fIncarnation}:revision:${row.fRevision}`,
    );
  }
}
