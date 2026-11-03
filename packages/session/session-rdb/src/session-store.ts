import { Context } from "@deepseek-ai/cordis";
import type { Volatile } from "@deepseek-ai/cosmokit";
import z from "@deepseek-ai/schemastery";
import {
  SessionAlreadyExistsError,
  SessionPersistence,
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
} from "@deepseek-ai/dsh-session-persistence";
import { SessionLogOffset } from "@deepseek-ai/dsh-session";
import type { SessionEvent, SessionHeader, SessionId } from "@deepseek-ai/dsh-session";
import { type Backend } from "./backend.ts";
import { SessionDeletionError } from "./deletion-error.ts";
import { WriteGuard } from "./write-guard.ts";
import { RdbBackendTracker, RdbSessionHandle } from "./handles.ts";

import { repairReadView } from "./log/repair.ts";
import { rowToMeta } from "./log/rows.ts";
import { DEFAULT_BUSY_TIMEOUT_MS, type JournalMode } from "./version.ts";
import { openRdbBackend, type BackendConfig } from "./db/open.ts";
import { SessionBranchRdb } from "./branch/index.ts";
import type { BranchPort } from "./branch/port.ts";
import { LiveRouting } from "./live-routing.ts";
import { createReadPath } from "./read-path.ts";
import { createWritePath } from "./write-path.ts";
import { registerSessionImport } from "./import.ts";
import { registerSessionDeletion } from "./deletion.ts";
import { registerSessionExport } from "./export.ts";
import { registerSessionOrganize } from "./organize.ts";
import { registerSessionRows } from "./rows.ts";
import { registerSessionUsage } from "./usage.ts";
import type { UsageAggregate } from "./usage.ts";
import { SessionQueryRdb } from "./session-query.ts";
import { installStorageTakeover } from "./storage-takeover/index.ts";

export type Config =
  | {
      type: "sqlite";
      path: string;
      journalMode?: JournalMode | undefined;
      busyTimeout?: number | undefined;
      preparedSessionCacheSize?: number | undefined;
    }
  | {
      type: "postgres";
      connectionString: string;
      schema?: string | undefined;
      preparedSessionCacheSize?: number | undefined;
    };

// schema 解析之后的形状：整段 Config 是 **volatile 稳定引用**（页面可编辑），读它要过 `.get()`。
export type ResolvedConfig = Volatile<Config>;

export { SessionDeletionError, type SessionDeletionErrorCode } from "./deletion-error.ts";

// 本地化说明：`description()` 的类型签名只声明 `string`，而 meta 本身接受 `Dict<string>`
// （`vendor/schemastery/src/index.ts` 的 `mergeDesc` 就是按字典合并的），所以这里只做一次类型放行。
const localized = (text: { zh: string; en: string }): string => text as unknown as string;

// 投影 checkpoint 的写回节流：两个分支共用。
// 上游 session-query 的**冷会话观察缓存**容量（`preparedSessionCacheSize`）：缓存按**条目数**持有完整
// `Session`（含整份 append-only log），被活跃观察租约钉住的条目不淘汰；一次读取中途转成 live 时会重试 live
// 路径，但**不会顺手清掉已缓存的 cold 条目**——所以同一个 id 可能同时有两份 log 驻留。上游默认 5；本部署把它
// 收到最小的 1：本地单用户、rdb 后端，冷读复用的收益不值这份内存放大。上游校验是 >= 1（不能设 0）。
const preparedSessionCacheSchema = z
  .number()
  .step(1)
  .min(1)
  .default(1)
  .description(
    localized({
      zh: "冷会话观察缓存容量（条数，最小 1）：每个条目持一份完整会话日志；本部署默认 1，把同 id 两份日志的驻留压到最小。",
      en: "Cold prepared-Session observation cache size (entries, minimum 1): each entry holds one complete session log. This deployment defaults to 1, minimizing duplicate per-id residency.",
    }),
  );

export class SessionPersistenceRdb extends SessionPersistence {
  static inject = ["sessions"];

  // 显式声明「输入 → 解析后」的形状：整段是 volatile，读它要过 `.get()`。union + volatile 的推断形状与手写类型
  // 在可选性 / 索引签名上不完全对齐，所以这里断言一次，类型面由此固定。
  static Config = z
    .union([
      z.object({
        type: z.const("sqlite"),
        path: z
          .string()
          .required()
          .description(
            localized({
              zh: "SQLite 数据库文件路径；`:memory:` 是内存库（进程结束即丢）。",
              en: "SQLite database file path; `:memory:` keeps it in memory and loses it with the process.",
            }),
          ),
        journalMode: z
          .union(["wal", "delete", "truncate", "persist"] as const)
          .default("wal")
          .description(
            localized({
              zh: "SQLite 日志模式；默认 wal（并发读最好）。",
              en: "SQLite journal mode; `wal` by default (best concurrent reads).",
            }),
          ),
        busyTimeout: z
          .number()
          .step(1)
          .min(0)
          .default(DEFAULT_BUSY_TIMEOUT_MS)
          .description(
            localized({
              zh: "写锁冲突时的忙等超时（毫秒）。",
              en: "Busy timeout in ms while a write lock is contended.",
            }),
          ),
        preparedSessionCacheSize: preparedSessionCacheSchema,
      }),
      z.object({
        type: z.const("postgres"),
        connectionString: z
          .string()
          .required()
          .description(
            localized({
              zh: "PostgreSQL 连接串（含库名与凭证）。",
              en: "PostgreSQL connection string (database and credentials).",
            }),
          ),
        schema: z
          .string()
          .default("public")
          .description(
            localized({
              zh: "库内的 schema 名；默认 public。",
              en: "Schema name inside the database; `public` by default.",
            }),
          ),
        preparedSessionCacheSize: preparedSessionCacheSchema,
      }),
    ])
    .description(
      localized({
        zh: "会话持久化后端：改这里的连接参数会在这一行重挂时生效（Loader 会重装被改的行）。",
        en: "Session persistence backend: edits apply when this row is remounted (the Loader re-installs changed rows).",
      }),
    )
    .volatile() as unknown as z<Config, ResolvedConfig>;

  override readonly name = "session-rdb";

  readonly tracker = new RdbBackendTracker(this.name);

  /** 打开后的后端；未打开时访问会 fail loud（装配内部、分支端口与测试共用）。 */
  backend!: Backend;
  private storeIdentity!: string;
  /** 后端打开完成（分支端口与 live 路由都先等它）。 */
  readonly ready: Promise<void>;
  /** 写者位点守卫（分支的 rewind 与写路径共用）。 */
  readonly writeGuard = new WriteGuard();
  private readonly live: LiveRouting;
  private readonly readPath: ReturnType<typeof createReadPath>;
  private readonly writePath: ReturnType<typeof createWritePath>;

  private readonly reuseEventIds = new Map<SessionId, Map<number, string>>();


  // 本次装配用的配置快照（整段 Config 是 volatile，重挂会给新的）。
  readonly config: Config;

  constructor(
    ctx: Context,
    config: ResolvedConfig,
  ) {
    super(ctx);

    // 配置就是这一行的 config（cordis.patch.yml / profile patch，或设置页改它）；整段 Config 标了 volatile，
    // 生效靠 **Loader 重挂这一行**（settings 写完经 `reconcileProfilePatches` 重装受影响的 entry）——重挂构造
    // 新实例、拿到新快照，所以这里取一次就够，运行期不必反复读引用。
    this.config = config.get();
    this.ready = this.init();
    this.readPath = createReadPath({
      ready: this.ready,
      backend: () => this.backend,
      tracker: this.tracker,
      logger: ctx.logger,
      revisionOf: (row) => this.rowRevision(row),
    });
    this.writePath = createWritePath({
      ready: this.ready,
      backend: () => this.backend,
      tracker: this.tracker,
      writeGuard: this.writeGuard,
      reuseEventIds: this.reuseEventIds,
      logger: ctx.logger,
      readLog: async (id) => {
        const log = await this.readPath.readLog(id, {});
        return log === undefined
          ? undefined
          : { meta: log.meta, inheritedEventCount: log.inheritedEventCount, events: log.events };
      },
    });
    this.live = new LiveRouting(ctx, this);
    this.live.install();

    new SessionBranchRdb(this.ctx);

    // 冷会话观察缓存的容量在这一行配置里（默认见 `preparedSessionCacheSchema`）；session-query 自己不会再读它。
    const queryConfig =
      this.config.preparedSessionCacheSize === undefined
        ? {}
        : { preparedSessionCacheSize: this.config.preparedSessionCacheSize };
    this.ctx.plugin(SessionQueryRdb, queryConfig);

    registerSessionImport(this.ctx, this);

    registerSessionDeletion(this.ctx, this);

    registerSessionExport(this.ctx, this);

    registerSessionOrganize(this.ctx, this);

    registerSessionUsage(this.ctx, this);

    // 路由与 storage 接管都在构造期装配，但 backend 是异步打开的：拿到的是「打开后才有值」的读取口。
    registerSessionRows(this.ctx, () => this.database());

    installStorageTakeover(this.ctx, {
      repository: () => this.database().then((backend) => backend.storage),
      ready: this.ready,
    });
  }

  /** 打开完成后的 backend（所有 DB 操作的门）。 */
  private async database(): Promise<Backend> {
    await this.ready;
    return this.backend;
  }

  private async init(): Promise<void> {
    this.backend = await openRdbBackend(backendConfigOf(this.config));
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
      (await this.backend.reads.getSession(snapshot.id)) !== undefined
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
      const log = await this.readPath.readLog(id, {}, options?.signal);
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
      const log = await this.readPath.readLog(id, {}, options?.signal);
      if (log === undefined) throw new SessionPersistenceNotFoundError(id);
      repairReadView(log.events);
      validateStoredEvents(log.meta, log.events);

      if (log.migrated && log.events.length !== log.storedCount) {
        await this.writePath.rewriteMigratedLog(id, log);
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
    const row = await this.backend.reads.getSession(id);
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
    const rows = await this.backend.reads.listSessions();
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
    const row = await this.backend.reads.getSession(id);
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
    const referenced = await this.backend.transaction((tx) => tx.deleteSession(id));
    this.live.forget(id);
    this.reuseEventIds.delete(id);
    await this.writePath.dropSessionStats(id);
    await this.writePath.refreshEventUsageFlags(referenced);
  }

  /**
   * 整理数据：回收孤儿会话与孤儿事件行，然后**整表重算**三张派生统计表，最后 VACUUM。
   *
   * 顺序有依赖：先清孤儿（被删会话独占的事件行才刚成为孤儿），再按事件表重算统计，
   * 否则统计会把刚删掉的引用算回去。
   * @returns 三项计数（孤儿会话 / 孤儿事件行 / 重建涉及的会话数）。
   */
  async organize(): Promise<{
    orphanSessions: number;
    orphanEvents: number;
    rebuiltSessions: number;
  }> {
    await this.ready;
    const orphanSessions = await this.collectOrphanSessions();
    const orphanEvents = await this.collectOrphans();
    const rebuiltSessions = await this.backend.rebuildAllStats();
    await this.backend.vacuum();
    return { orphanSessions, orphanEvents, rebuiltSessions };
  }

  // 回收已无桥接行引用的事件行（孤儿），返回删除行数。
  async collectOrphans(): Promise<number> {
    await this.ready;
    return this.backend.collectOrphans();
  }

  // GC 通道：回收父已不存在的 subagent 会话（live 的跳过），返回删除的会话数。
  async collectOrphanSessions(): Promise<number> {
    await this.ready;
    const orphans = await this.backend.listOrphanSubagentSessions();
    const deletable = orphans.filter(
      (id) => !this.tracker.hasPending(id) && !this.tracker.hasOpenHandle(id),
    );
    if (deletable.length === 0) return 0;
    const { deleted, eventIds } = await this.backend.transaction((tx) =>
      tx.deleteSessions(deletable),
    );
    for (const id of deletable) {
      this.live.forget(id);
      this.reuseEventIds.delete(id);
      await this.writePath.dropSessionStats(id);
    }
    await this.writePath.refreshEventUsageFlags(eventIds);
    return deleted;
  }

  // 用量统计：SQL 聚合的按天 × 模型桶与按会话行（事件行去重、排除孤儿行）。
  async usageReport(sinceMs?: number): Promise<UsageAggregate> {
    await this.ready;
    return this.backend.usageReport(sinceMs);
  }

  // GC 通道：VACUUM；调用方需先停止运行中的写路径（见 `registerSessionGc`）。
  async vacuum(): Promise<void> {
    await this.ready;
    await this.backend.vacuum();
  }

  /**
   * 已归档的会话 id（`t_sessions.f_archived_at` 非空）。`session/list` 默认过滤掉它们。
   * 读的是持久化里的归档标记，不依赖 `workspaceRegistry` 服务的就绪时机。
   * @returns 归档过的 Session id 集。
   */
  async archivedSessionIds(): Promise<ReadonlySet<string>> {
    await this.ready;
    const state = (await this.backend.storage.readDomainGlobal("workspace")) as {
      archivedSessionIds?: readonly string[];
    } | null;
    return new Set((state?.archivedSessionIds ?? []).map(String));
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

  // 内部接口（句柄、live 路由、导出、测试）用的入口：实现分别在 `read-path.ts` / `write-path.ts`。
  readLog(
    id: SessionId,
    options: { fromSeq?: number } = {},
    signal?: AbortSignal,
  ) {
    return this.readPath.readLog(id, options, signal);
  }

  readRaw(id: SessionId, signal?: AbortSignal) {
    return this.readPath.readRaw(id, signal);
  }

  listSnapshots(signal?: AbortSignal) {
    return this.readPath.listSnapshots(signal);
  }

  readStoredRevision(id: SessionId, signal?: AbortSignal) {
    return this.readPath.readStoredRevision(id, signal);
  }

  materializeEmpty(meta: SessionHeader, inheritedEventCount: SessionLogOffset) {
    return this.writePath.materializeEmpty(meta, inheritedEventCount);
  }

  appendBatch(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
    tornTruncateTo?: number,
  ) {
    return this.writePath.appendBatch(meta, inheritedEventCount, events, tornTruncateTo);
  }

  async close(): Promise<void> {
    await this.ready;
    await this.backend.close();
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
    // 一条读取路径：load 的语义是「读一次完整快照」，不经 handle 面再读一遍。
    const log = await this.readPath.readLog(id, {}, signal);
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
    const log = await this.readPath.readLog(id, { fromSeq }, signal);
    if (log === undefined) throw new SessionPersistenceNotFoundError(id);
    return {
      meta: log.meta,
      inheritedEventCount: log.inheritedEventCount,
      events: log.events,
    };
  }

  registerReuseEventIds(childId: SessionId, map: ReadonlyMap<number, string>): void {
    this.reuseEventIds.set(childId, new Map(map));
  }

  // 丢弃一个还没被消费的复用映射（fork 失败时）：留着会让同一个 childId 之后的落写复用父会话的事件行。
  dropReuseEventIds(childId: SessionId): void {
    this.reuseEventIds.delete(childId);
  }

  /** 分支能力的端口（见 `branch/port.ts`）：每个动词都有真实调用方，不是服务方法表的转抄。 */
  branchPort(): BranchPort {
    return {
      ready: this.ready,
      readLog: (id, options, signal) => this.readPath.readLog(id, options ?? {}, signal),
      create: (meta, options) => this.create(meta, options),
      eventRows: (id, fromSequence) => this.backend.reads.getEventRows(id, fromSequence),
      eventTypesBefore: (id, before, limit) => this.backend.reads.getEventTypesBefore(id, before, limit),
      sessionRow: (id) => this.backend.reads.getSession(id),
      eventTypeAt: (id, sequence) => this.backend.reads.getEventTypeAt(id, sequence),
      transaction: (fn) => this.backend.transaction(fn),
      confirmHead: (id, sequence) => this.writeGuard.confirmHead(id, sequence),
      readStoredRevision: (id) => this.readPath.readStoredRevision(id),
      registerReuseEventIds: (childId, map) => this.registerReuseEventIds(childId, map),
      dropReuseEventIds: (childId) => this.dropReuseEventIds(childId),
      resetWriterAfterRewind: (id, cursor, inheritedEventCount) => {
        this.tracker.writerOf(id)?.resetAfterRewind(cursor, inheritedEventCount);
      },
    };
  }

  private rowRevision(row: import("./backend.ts").SessionRow): SessionPersistenceRevision {
    return SessionPersistenceRevision(
      `${this.storeIdentity}:incarnation:${row.fIncarnation}:revision:${row.fRevision}`,
    );
  }
}

/** 装配层配置 → 打开后端所需的最小形状（两方言共用）。 */
function backendConfigOf(config: Config): BackendConfig {
  return config.type === "sqlite"
    ? {
        type: "sqlite",
        path: config.path,
        journalMode: config.journalMode ?? "wal",
        busyTimeout: config.busyTimeout ?? DEFAULT_BUSY_TIMEOUT_MS,
      }
    : {
        type: "postgres",
        connectionString: config.connectionString,
        ...(config.schema === undefined ? {} : { schema: config.schema }),
      };
}

export default SessionPersistenceRdb;
