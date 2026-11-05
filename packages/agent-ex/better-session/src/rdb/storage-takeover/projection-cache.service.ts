// 投影检查点（`sessionProjectionCache`）的 RDB 实现：检查点行落 `t_session_projcache_row`。
//
// 从源包 `session-rdb/src/storage-takeover/projection-cache.ts` 搬来，只换装配写法（`@Injectable` +
// `inject`）：库句柄从会话持久化那一行取（`storageRepository()`），KV 域与检查点行必须同一个库。
//
// 没有攒批参数：检查点按「与已落库那行相比是否有变化」决定写不写，与事件条数 / 时间无关。
import {
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionSeqCursor,
} from "@morlay/dsh-session/contract";
import type {
  ProjectionCheckpoint,
  ProjectionKeySelection,
  ProjectionSnapshot,
  SessionProjectionMap,
} from "@morlay/dsh-session/contract";
import { SessionProjectionCache, SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import {
  inject,
  Injectable,
  Logger,
  type Context,
  type OnDispose,
  type OnInit,
} from "@morlay/zephyr";
import { asRdbStore } from "../../contract/session-rdb-store.contract.ts";
import type {
  CheckpointIdentity,
  ProjectionCheckpointRow,
  StorageRepository,
  StoredProjcacheEntry,
} from "./types.ts";

/** 服务名（上游按驼峰读；`@Injectable({ name })` 的别名就是它）。 */
export const SESSION_PROJECTION_CACHE_SERVICE = "sessionProjectionCache";

type CurrentCheckpointIdentity = CheckpointIdentity & {
  formatVersion: number;
  isSeeded: boolean;
  inheritedEventCount: number;
};

// header 能证明的生命周期身份（header-only 匹配口径）。
type LifecycleIdentity = CheckpointIdentity & {
  formatVersion: number;
  isSeeded: boolean;
};

const PREDECESSOR_TITLE_KEY = "title" as Extract<keyof SessionProjectionMap, string>;

// 上游的 keys 选择面既接受数组也接受 `ReadonlySet`（`sessionProjections.summaryKeys()` 给的是 Set）。
// 只看一个键时两种都要认——之前只按数组写了 `.includes`，Set 上直接抛 `keys.includes is not a function`，
// 列表行于是整列投影都没有（会话标题显示"未命名"）。
function selects(
  keys: ProjectionKeySelection | undefined,
  key: Extract<keyof SessionProjectionMap, string>,
): boolean {
  if (keys === undefined) return true;
  if ("has" in keys) return keys.has(key);
  return (keys as readonly string[]).includes(key);
}

/**
 * 投影检查点服务：写路径按「检查点是否有变化」增量写回，读路径只读进程内镜像
 * （与已落库状态同源），撤回按新水位截断。
 *
 * 构造期不碰库：`onInit` 才等持久化就绪、开库、清掉水位早于已落库日志的快照行。
 */
@Injectable({ name: SESSION_PROJECTION_CACHE_SERVICE })
export class SessionProjectionCacheRdb implements SessionProjectionCache, OnInit, OnDispose {
  private readonly persistence = inject(SessionPersistence);

  private readonly projections = inject(SessionProjectionStore);

  private readonly sessions = inject(SessionStore);

  private readonly logger = inject(Logger);

  /**
   * 上游按形状读的攒批参数：RDB 版按「检查点有没有变」写，不按条数 / 时间攒批，这两个值不参与决策。
   */
  readonly config = { writeEveryEvents: 0, writeIntervalMs: 0 };

  private readonly records = new Map<SessionId, StoredProjcacheEntry>();

  // 同一 tick 内的事件合并成一次「落库 + 检查点比对」，这不是攒批：flush 之后事件已经在库里。
  private readonly queued = new Set<SessionId>();

  private repository: StorageRepository | undefined;

  private row: Context | undefined;

  private disposed = false;

  async onInit(ctx: Context): Promise<void> {
    this.row = ctx;
    const store = asRdbStore(this.persistence);
    let repository: StorageRepository;
    try {
      await store.ready;
      repository = await store.storageRepository();
    } catch (error: unknown) {
      // 坏库 / 身份不符不该让**装配**失败（那一行自己的读会报错）：缓存是派生数据，关掉它只是让冷读
      // 多 fold 一段日志。与 `SessionPersistenceRdb.onInit`「坏库不该让装配失败」同一口径。
      this.logger.warn(
        "session projection cache: session store is not ready, checkpoint cache stays off: " +
          (error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    this.repository = repository;

    // 空库没有可清的行：一次读就够（共用同一个库文件的并发实例不该在装配期抢写锁）。
    let entries = await repository.loadProjcache();
    if (entries.length > 0) {
      const pruned = await repository.pruneStaleProjcache();
      if (pruned > 0) {
        this.logger.info(
          "session projection cache: pruned stale snapshot(s) for " +
            String(pruned) +
            " session(s)",
        );
        entries = await repository.loadProjcache();
      }
    }
    for (const entry of entries) {
      this.records.set(entry.sessionId, entry);
    }
    this.installWritePath();
  }

  onDispose(): void {
    this.disposed = true;
    this.queued.clear();
  }

  private lookup(id: SessionId): StoredProjcacheEntry | undefined {
    return this.records.get(id);
  }

  private recordFor(
    id: SessionId,
    expected: CurrentCheckpointIdentity,
  ): StoredProjcacheEntry | undefined {
    const record = this.lookup(id);
    if (record === undefined) return undefined;
    return identityMatches(record.identity, expected) ? record : undefined;
  }

  // header-only 读（会话列表这类）：只给 header 与 keys，要求的是**生命周期**身份，不需要调用方提供
  // inherited cut（那个只有写路径与 hydration 用得上）。
  cachedSnapshot(
    meta: SessionHeader,
    keys?: ProjectionKeySelection,
  ): ProjectionSnapshot | undefined {
    const record = this.recordForLifecycle(meta);
    const snapshot = record === undefined ? undefined : this.viewRecord(record, keys);
    return this.withDirectTitle(meta.id, keys, snapshot);
  }

  private recordForLifecycle(meta: SessionHeader): StoredProjcacheEntry | undefined {
    const record = this.lookup(meta.id);
    return record === undefined || !identityMatches(record.identity, lifecycleIdentityOf(meta))
      ? undefined
      : record;
  }

  private withDirectTitle(
    id: SessionId,
    keys: ProjectionKeySelection | undefined,
    snapshot: ProjectionSnapshot | undefined,
  ): ProjectionSnapshot | undefined {
    if (!selects(keys, PREDECESSOR_TITLE_KEY)) return snapshot;
    if (snapshot?.values[PREDECESSOR_TITLE_KEY] !== undefined) return snapshot;
    const title = this.records.get(id)?.title;
    if (title === undefined) return snapshot;
    const values = { ...snapshot?.values, [PREDECESSOR_TITLE_KEY]: title.title };
    const asOfSeq =
      snapshot === undefined ? title.seq : Math.min(snapshot.asOfSeq as number, title.seq);
    return { asOfSeq: asOfSeq as SessionSeqCursor, values };
  }

  cachedPredecessorTitle(meta: SessionHeader): ProjectionSnapshot | undefined {
    const record = this.lookup(meta.id);
    if (
      record === undefined ||
      !predecessorIdentityMatches(record.identity, lifecycleIdentityOf(meta))
    ) {
      return undefined;
    }
    return this.viewRecord(record, [PREDECESSOR_TITLE_KEY]);
  }

  private viewRecord(
    record: StoredProjcacheEntry,
    keys?: ProjectionKeySelection,
  ): ProjectionSnapshot | undefined {
    const values = this.projections.viewCheckpoint(record.rows, keys);
    const servedKeys = Object.keys(values);
    if (servedKeys.length === 0) return undefined;

    const firstKey = servedKeys[0] as string;
    let asOfSeq = record.rows[firstKey]?.seq as SessionSeqCursor;
    for (const key of servedKeys.slice(1)) {
      const row = record.rows[key] as ProjectionCheckpointRow;
      if ((row.seq as number) < (asOfSeq as number)) asOfSeq = row.seq as SessionSeqCursor;
    }
    return { asOfSeq, values };
  }

  hydratePrepared(session: Session, events: readonly SessionEvent[]): ProjectionSnapshot {
    const record = this.recordFor(
      session.id,
      identityOf(session.header, session.inheritedEventCount),
    );
    if (record === undefined) {
      return this.projections.hydrate(session, {}, events, SessionLogOffset(0));
    }
    try {
      return this.projections.hydrate(session, record.rows, events, SessionLogOffset(0));
    } catch {
      return this.projections.hydrate(session, {}, events, SessionLogOffset(0));
    }
  }

  async write(session: Session): Promise<void> {
    // 先比差异，**有变化才碰 SQLite**：没变化直接返回，既不写检查点、也不推上游 flush
    //（事件落库的主节奏是上游 handle 的批量窗口，逐条 flush 会把写放大到每秒数十次）。
    const rows = this.projections.checkpoint(session);
    const previous = this.lookup(session.id)?.rows;
    if (previous !== undefined && sameCheckpoint(previous, rows)) return;

    if (this.sessions.get(session.id) === session) {
      // 检查点是内存 log 的快照：先把 live 事件落库再写检查点，但 **flush 失败不该阻断检查点**——
      // 否则撤回后缓存会停在旧水位，读路径一直显示撤回前的数据（要重启实例才从库里重新加载）。
      // flush 失败本身由上游记账，这里只补一条 warn。
      try {
        await this.sessions.flush(session);
      } catch (error: unknown) {
        this.logger.warn(
          'session projection cache: flush before checkpoint for "' +
            session.id +
            '" failed (checkpoint still written from the in-memory log): ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    const changed = changedRows(previous, rows);
    const removedKeys = Object.keys(previous ?? {}).filter((key) => rows[key] === undefined);
    await this.patch(
      session.id,
      identityOf(session.header, session.inheritedEventCount),
      changed,
      removedKeys,
    );
  }

  // 增量写回：只 upsert 变化的行、删掉消失的 key，其余行不碰（整份删重插是纯写放大）。
  private async patch(
    id: SessionId,
    identity: CheckpointIdentity,
    changed: Record<string, ProjectionCheckpointRow>,
    removedKeys: readonly string[],
  ): Promise<void> {
    const repository = this.requireRepository();
    const detachedChanged = detachJson(changed);
    await repository.patchProjcache(id, detachedChanged, removedKeys);

    const merged: Record<string, ProjectionCheckpointRow> = {};
    const previous = this.records.get(id)?.rows;
    if (previous !== undefined) Object.assign(merged, previous);
    Object.assign(merged, detachedChanged);
    for (const key of removedKeys) delete merged[key];
    const title = await repository.readSessionTitle(id);
    this.records.set(id, {
      sessionId: id,
      identity,
      rows: merged,
      ...(title === undefined ? {} : { title }),
    });
  }

  // rewind 后 head 回退：把水位超出新 head 的投影单元丢弃，保留仍在截断前缀内的行。
  // 这是零 I/O 读的更新（不 fold 日志）：下次零 I/O 读拿到的是截断后的水位，而不是旧值。
  async truncateTo(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    headSeq: number,
  ): Promise<void> {
    const identity = identityOf(meta, inheritedEventCount);
    const record = this.recordFor(meta.id, identity);
    if (record === undefined) return;
    const rows = Object.fromEntries(
      Object.entries(record.rows).filter(
        ([, row]) => ((row as ProjectionCheckpointRow).seq as number) <= headSeq,
      ),
    );
    await this.put(meta.id, identity, rows);
  }

  coldSnapshot(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
  ): ProjectionSnapshot {
    const identity = identityOf(meta, inheritedEventCount);
    const restored = this.projections.restore(
      this.recordFor(meta.id, identity)?.rows ?? {},
      events,
      SessionLogOffset(0),
      meta,
      inheritedEventCount,
    );

    void this.put(meta.id, identity, restored.checkpoint).catch((error: unknown) => {
      this.logger.warn(
        'session projection cache: cold-read write-back for "' +
          meta.id +
          '" failed (cache stays stale): ' +
          String(error),
      );
    });
    return restored.snapshot;
  }

  private installWritePath(): void {
    this.row?.on("session/event", (session: Session) => {
      this.scheduleWrite(session, "event");
    });

    this.row?.on("session/created", (session: Session) => {
      void this.flushSoft(session, "create");
    });

    this.row?.on("session/disposed", (session: Session) => {
      void this.flushSoft(session, "detach");
      this.queued.delete(session.id);
    });
  }

  // 同一 tick 的多条事件合成一次：flush 一次、checkpoint 取一次、diff 一次。
  // 落库时机不再取决于事件条数或定时器——事件一到就写库，检查点则只在真的变了才写。
  private scheduleWrite(session: Session, trigger: string): void {
    if (this.queued.has(session.id)) return;
    this.queued.add(session.id);
    queueMicrotask(() => {
      this.queued.delete(session.id);
      if (this.disposed) return;
      void this.flushSoft(session, trigger);
    });
  }

  private async flushSoft(session: Session, trigger: string): Promise<void> {
    try {
      await this.write(session);
    } catch (error: unknown) {
      this.logger.warn(
        "session projection cache: " +
          trigger +
          ' write for "' +
          session.id +
          '" failed (cache stays stale): ' +
          String(error),
      );
    }
  }

  private async put(
    id: SessionId,
    identity: CheckpointIdentity,
    rows: ProjectionCheckpoint,
  ): Promise<void> {
    const repository = this.requireRepository();
    const detached = detachJson(rows);

    await repository.putProjcache(id, detached);
    const title = await repository.readSessionTitle(id);
    this.records.set(id, {
      sessionId: id,
      identity,
      rows: detached,
      ...(title === undefined ? {} : { title }),
    });
  }

  private requireRepository(): StorageRepository {
    if (this.repository === undefined) {
      throw new Error("session projection cache is not initialized");
    }
    return this.repository;
  }
}

// 「有没有变化」的判据：逐行比 `ver` 与 `val`，**不比 `seq`**。`seq` 是「最后折入的事件」水位，
// 上游投影对每个事件都会推进它（哪怕 apply 返回同一份 state），拿它当判据等于每个事件都写一次。
// 值没变就跳过写回：读侧仍会从旧水位重放那几条事件，得到同样的值——缓存要的是「值对不对」，
// 不是「水位最新」。`val` 是纯 JSON（写入前已 detach），逐键序列化比较即可。
function sameRow(before: ProjectionCheckpointRow, after: ProjectionCheckpointRow): boolean {
  return before.ver === after.ver && JSON.stringify(before.val) === JSON.stringify(after.val);
}

// 只挑出真的变了的行：写库只碰这些行，其余行原样留在库里（不删不重插）。
function changedRows(
  previous: Record<string, ProjectionCheckpointRow> | undefined,
  next: Record<string, ProjectionCheckpointRow>,
): Record<string, ProjectionCheckpointRow> {
  const changed: Record<string, ProjectionCheckpointRow> = {};
  for (const [key, row] of Object.entries(next)) {
    const before = previous?.[key];
    if (before === undefined || !sameRow(before, row)) changed[key] = row;
  }
  return changed;
}

function sameCheckpoint(
  previous: Record<string, ProjectionCheckpointRow>,
  next: Record<string, ProjectionCheckpointRow>,
): boolean {
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return false;
  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    if (before === undefined || after === undefined) return false;
    if (!sameRow(before, after)) return false;
  }
  return true;
}

function detachJson(rows: ProjectionCheckpoint): ProjectionCheckpoint {
  let text: string | undefined;
  try {
    text = JSON.stringify(rows);
  } catch (error) {
    throw new TypeError(
      "projection checkpoint is not losslessly JSON-serializable: " + String(error),
      { cause: error },
    );
  }
  if (text === undefined) {
    throw new TypeError("projection checkpoint is not losslessly JSON-serializable");
  }
  return JSON.parse(text) as ProjectionCheckpoint;
}

// header 能证明的生命周期身份（不含 inherited cut）：header-only 读只比对它。
function lifecycleIdentityOf(header: SessionHeader): LifecycleIdentity {
  return {
    formatVersion: header.version,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    isSeeded: header.isSeeded,
  };
}

function identityOf(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
): CurrentCheckpointIdentity {
  const cut = SessionLogOffset(inheritedEventCount);
  if (!header.isSeeded && cut !== 0) {
    throw new Error("unseeded projection-cache identity inherited event count must be 0");
  }
  return {
    formatVersion: header.version,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    isSeeded: header.isSeeded,
    inheritedEventCount: cut,
  };
}

function identityMatches(stored: CheckpointIdentity, expected: LifecycleIdentity): boolean {
  return (
    stored.formatVersion === expected.formatVersion && lifecycleIdentityMatches(stored, expected)
  );
}

function predecessorIdentityMatches(
  stored: CheckpointIdentity,
  expected: LifecycleIdentity,
): boolean {
  const predecessor =
    stored.formatVersion === undefined || stored.formatVersion < expected.formatVersion;
  return predecessor && lifecycleIdentityMatches(stored, expected);
}

function lifecycleIdentityMatches(
  stored: CheckpointIdentity,
  expected: LifecycleIdentity,
): boolean {
  // header-only 读的匹配口径：只看 formatVersion 与生命周期字段，**不比对 inherited cut**（那个只有写路径与
  // hydration 用得上）。
  return (
    stored.createdAt === expected.createdAt &&
    stored.cwd === expected.cwd &&
    (stored.isSeeded ?? false) === expected.isSeeded
  );
}
