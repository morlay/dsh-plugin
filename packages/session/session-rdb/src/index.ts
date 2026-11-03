import { Context } from "@deepseek-ai/cordis";
import type { Volatile } from "@deepseek-ai/cosmokit";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
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
import {
  SESSION_FORMAT_VERSION,
  SessionLogOffset,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SurfaceEventType,
} from "@deepseek-ai/dsh-session";
import { sessionFormatLogFilename } from "@deepseek-ai/dsh-session-format";
import { type Backend, type BackendTx, type EventInsert } from "./backend.ts";
import { SessionDeletionError } from "./deletion-error.ts";
import { WriteGuard } from "./write-guard.ts";
import { RdbBackendTracker, RdbSessionHandle } from "./handles.ts";
import { repairReadView } from "./log/repair.ts";
import { rowToMeta } from "./log/rows.ts";
import { scanRows, toJsonlArtifact } from "./log/export.ts";
import { usageRowOf } from "./log/usage-row.ts";
import type { EventUsageRow } from "./log/usage-row.ts";
import { eventDimensions } from "./event-shape.ts";
import { DEFAULT_BUSY_TIMEOUT_MS, EVENT_ENCODING, type JournalMode } from "./version.ts";
import { openRdbBackend, type BackendConfig } from "./backend-rdb.ts";
import { SessionBranchRdb } from "./branch/index.ts";
import type { BranchPort } from "./branch/port.ts";
import { LiveRouting } from "./live-routing.ts";
import { balanceRewindPrefix } from "@morlay/session-branch";
import { registerSessionImport } from "./import.ts";
import { registerSessionDeletion } from "./deletion.ts";
import { registerSessionExport } from "./export.ts";
import { registerSessionGc } from "./gc.ts";
import { registerSessionRows } from "./rows.ts";
import { registerSessionUsage } from "./usage.ts";
import type { UsageAggregate } from "./usage.ts";
import { SessionQueryRdb } from "./session-query.ts";
import { sessionCountBuckets, sessionUsageBuckets } from "./stats-fold.ts";
import { adoptLegacyRows, convertLegacyRows, isLegacyVersion } from "./legacy.ts";
import { needsShapeAdoption, sealOwnEvents } from "./log/repair.ts";
import { installStorageTakeover } from "./storage-takeover/index.ts";

// 一批事件里的最大时间：写路径据此推进会话行的「最后活动时间」。
function maxEventTime(events: readonly { readonly time?: number }[]): number | undefined {
  let max: number | undefined;
  for (const event of events) {
    const time = event.time;
    if (typeof time !== "number") continue;
    if (max === undefined || time > max) max = time;
  }
  return max;
}

export { SCHEMA_VERSION } from "./version.ts";
export { SESSION_ROWS_PATH } from "./rows.ts";
export type { SessionRowsItem, SessionRowsValue } from "./rows.ts";
export {
  SessionBranchRdb,
  SessionBranchRdbProvider,
  liveEventsOf,
  locateTurnEnd,
} from "./branch/index.ts";

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

    registerSessionGc(this.ctx, this);

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
    await this.dropSessionStats(id);
    await this.refreshEventUsageFlags(referenced);
  }

  // GC 通道：回收已无桥接行引用的事件行（孤儿），返回删除行数。
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
      await this.dropSessionStats(id);
    }
    await this.refreshEventUsageFlags(eventIds);
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
      await tx.updateHeadAndRevision(
        meta.id,
        appended.headEventId,
        appended.headSequence,
        maxEventTime(events),
      );
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
    const row = await this.backend.reads.getSession(id);
    if (row === undefined) return undefined;
    const meta = rowToMeta(row);
    const eventRows =
      options.fromSeq === undefined
        ? await this.backend.reads.getEventRows(id)
        : await this.backend.reads.getEventRows(id, options.fromSeq);
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

  // 统计衍生表的**旁路累加**：不在写事务里、失败只 warn——两张会话汇总表都是可销毁重建的
  // 派生表，丢几次累加不影响可用性（需要时用 `rebuildSessionStats` 重算）。
  // token 走写路径已折好的用量行，活动计数走本批事件类型。
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

  // 重算一个会话的两张汇总表（旧日志重写后；best-effort，同 `recordSessionStats`）——
  // fork 与 rewind 都不动统计。
  async rebuildSessionStats(id: SessionId): Promise<void> {
    await this.ready;
    try {
      await this.backend.rebuildSessionStats(id);
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `session-rdb: session stats for "${id}" not rebuilt (${describeError(error)})`,
      );
    }
  }

  // 重算这些用量行的引用标记（会话删除 / 日志重写之后：消失的引用要让孤儿行退出统计）。
  private async refreshEventUsageFlags(eventIds: readonly string[]): Promise<void> {
    const unique = [...new Set(eventIds)];
    if (unique.length === 0) return;
    try {
      await this.backend.refreshEventUsageFlags(unique);
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `session-rdb: usage reference flags not refreshed (${describeError(error)})`,
      );
    }
  }

  // 会话删除时清掉它的汇总行（引用标记由调用方在拿到被删事件后一并重算）。
  private async dropSessionStats(id: SessionId): Promise<void> {
    try {
      await this.backend.deleteSessionStats(id);
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
    let removed: readonly string[] = [];
    await this.backend.transaction(async (tx) => {
      // 重写会删光该会话的桥接行再重建，先做并发写者校验（与 `appendBatch` 同一个理由）：否则另一实例在
      // open 前 / 期间提交的事件会被静默丢掉；调用方刚读过这份日志，guard 没有该会话时记下当前磁盘 head。
      const head = await tx.getHead(id);
      if (!this.writeGuard.has(id)) this.writeGuard.confirmHead(id, head.fHeadSequence);
      this.writeGuard.assertNoConcurrentWriter(id, head.fHeadSequence);
      removed = await tx.deleteBridgeTail(id, 0);
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
    await this.refreshEventUsageFlags(removed);
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
    const rows = await this.backend.reads.listSessions();
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
    const row = await this.backend.reads.getSession(id);
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
    // 一条读取路径：load 的语义是「读一次完整快照」，不经 handle 面再读一遍。
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

  // 丢弃一个还没被消费的复用映射（fork 失败时）：留着会让同一个 childId 之后的落写复用父会话的事件行。
  dropReuseEventIds(childId: SessionId): void {
    this.reuseEventIds.delete(childId);
  }

  /** 分支能力的端口（见 `branch/port.ts`）：每个动词都有真实调用方，不是服务方法表的转抄。 */
  branchPort(): BranchPort {
    return {
      ready: this.ready,
      readLog: (id, options, signal) => this.readLog(id, options ?? {}, signal),
      create: (meta, options) => this.create(meta, options),
      eventRows: (id, fromSequence) => this.backend.reads.getEventRows(id, fromSequence),
      eventTypesBefore: (id, before, limit) => this.backend.reads.getEventTypesBefore(id, before, limit),
      sessionRow: (id) => this.backend.reads.getSession(id),
      eventTypeAt: (id, sequence) => this.backend.reads.getEventTypeAt(id, sequence),
      transaction: (fn) => this.backend.transaction(fn),
      confirmHead: (id, sequence) => this.writeGuard.confirmHead(id, sequence),
      readStoredRevision: (id) => this.readStoredRevision(id),
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
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
