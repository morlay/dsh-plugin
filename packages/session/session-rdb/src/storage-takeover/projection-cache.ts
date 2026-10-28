import { Context, Service } from "@deepseek-ai/cordis";
import { SessionLogOffset } from "@deepseek-ai/dsh-session";
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionSeqCursor,
} from "@deepseek-ai/dsh-session";
import type {
  ProjectionCheckpoint,
  ProjectionKeySelection,
  ProjectionSnapshot,
  SessionProjectionMap,
} from "@deepseek-ai/dsh-session-projection";

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
import type {
  StorageRepository,
  StoredProjcacheEntry,
  CheckpointIdentity,
  ProjectionCheckpointRow,
} from "./types.ts";

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

// 没有攒批参数：投影检查点按「与已落库那行相比是否有变化」决定写不写，与事件条数 / 时间无关。

export interface SessionProjectionCacheRdbOptions {
  repository: StorageRepository;
  ready: Promise<unknown>;
}

const PREDECESSOR_TITLE_KEY = "title" as Extract<keyof SessionProjectionMap, string>;

export class SessionProjectionCacheRdb extends Service {
  static inject = ["sessionProjections", "sessions"];

  private readonly records = new Map<SessionId, StoredProjcacheEntry>();
  // 同一 tick 内的事件合并成一次「落库 + 检查点比对」，这不是攒批：flush 之后事件已经在库里。
  private readonly queued = new Set<SessionId>();

  private readonly directReads: boolean;
  private readonly repository: StorageRepository;
  private readonly ready: Promise<unknown>;

  constructor(ctx: Context, options: SessionProjectionCacheRdbOptions) {
    super(ctx, SESSION_PROJECTION_CACHE_SERVICE);
    this.repository = options.repository;
    this.ready = options.ready;
    this.directReads = options.repository.readProjcacheDirect !== undefined;
  }

  protected async [Service.init](): Promise<void> {
    this.installWritePath();
    await this.ready;

    const pruned = await this.repository.pruneStaleProjcache();
    if (pruned > 0) {
      this.ctx.logger.info(
        `session projection cache: pruned stale snapshot(s) for ${String(pruned)} session(s)`,
      );
    }
    if (!this.directReads) {
      for (const entry of await this.repository.loadProjcache()) {
        this.records.set(entry.sessionId as SessionId, entry);
      }
    }
  }

  private lookup(id: SessionId): StoredProjcacheEntry | undefined {
    if (this.directReads) return this.repository.readProjcacheDirect?.(id);
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
    const direct = this.repository.readSessionTitleDirect?.(id);
    if (direct === undefined) return snapshot;
    const values = { ...snapshot?.values, [PREDECESSOR_TITLE_KEY]: direct.title };

    const asOfSeq =
      snapshot === undefined ? direct.seq : Math.min(snapshot.asOfSeq as number, direct.seq);
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
    const values = this.ctx.sessionProjections.viewCheckpoint(
      record.rows as unknown as ProjectionCheckpoint,
      keys,
    );
    const servedKeys = Object.keys(values);
    if (servedKeys.length === 0) return undefined;

    const firstKey = servedKeys[0] as string;
    let asOfSeq = (record.rows[firstKey] as ProjectionCheckpointRow).seq as SessionSeqCursor;
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
      return this.ctx.sessionProjections.hydrate(session, {}, events, SessionLogOffset(0));
    }
    try {
      return this.ctx.sessionProjections.hydrate(
        session,
        record.rows as unknown as ProjectionCheckpoint,
        events,
        SessionLogOffset(0),
      );
    } catch {
      return this.ctx.sessionProjections.hydrate(session, {}, events, SessionLogOffset(0));
    }
  }

  async write(session: Session): Promise<void> {
    // 先比差异，**有变化才碰 SQLite**：没变化直接返回，既不写检查点、也不推上游 flush
    //（事件落库的主节奏是上游 handle 的批量窗口，逐条 flush 会把写放大到每秒数十次——
    // 见 [设计 写路径](../designs/20260917-写路径.md)「否掉的选项」）。
    const rows = this.ctx.sessionProjections.checkpoint(session) as unknown as Record<
      string,
      ProjectionCheckpointRow
    >;
    const previous = this.lookup(session.id)?.rows;
    if (previous !== undefined && sameCheckpoint(previous, rows)) return;

    if (this.ctx.sessions.get(session.id) === session) await this.ctx.sessions.flush(session);

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
    const detachedChanged = detachJson(changed);
    await this.repository.patchProjcache(id, detachedChanged, removedKeys);
    if (this.directReads) return;

    const merged: Record<string, ProjectionCheckpointRow> = {};
    const previous = this.records.get(id)?.rows;
    if (previous !== undefined) Object.assign(merged, previous);
    Object.assign(merged, detachedChanged);
    for (const key of removedKeys) delete merged[key];
    this.records.set(id, { sessionId: id, identity, rows: merged });
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
    await this.put(meta.id, identity, rows as unknown as Record<string, ProjectionCheckpointRow>);
  }

  coldSnapshot(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
  ): ProjectionSnapshot {
    const identity = identityOf(meta, inheritedEventCount);
    const restored = this.ctx.sessionProjections.restore(
      (this.recordFor(meta.id, identity)?.rows ?? {}) as unknown as ProjectionCheckpoint,
      events,
      SessionLogOffset(0),
      meta,
      inheritedEventCount,
    );

    void this.put(
      meta.id,
      identity,
      restored.checkpoint as unknown as Record<string, ProjectionCheckpointRow>,
    ).catch((error: unknown) => {
      this.ctx.logger.warn(
        `session projection cache: cold-read write-back for "${meta.id}" failed (cache stays stale): ${String(error)}`,
      );
    });
    return restored.snapshot;
  }

  private installWritePath(): void {
    this.ctx.on("session/event", (session: Session) => {
      this.scheduleWrite(session, "event");
    });

    this.ctx.on("session/created", (session: Session) => {
      void this.flushSoft(session, "create");
    });

    this.ctx.on("session/disposed", (session: Session) => {
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
      void this.flushSoft(session, trigger);
    });
  }

  private async flushSoft(session: Session, trigger: string): Promise<void> {
    try {
      await this.write(session);
    } catch (error) {
      this.ctx.logger.warn(
        `session projection cache: ${trigger} write for "${session.id}" failed (cache stays stale): ${String(error)}`,
      );
    }
  }

  private async put(
    id: SessionId,
    identity: CheckpointIdentity,
    rows: Record<string, ProjectionCheckpointRow>,
  ): Promise<void> {
    const detached = detachJson(rows);

    await this.repository.putProjcache(id, detached);

    if (!this.directReads) this.records.set(id, { sessionId: id, identity, rows: detached });
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

function detachJson(
  rows: Record<string, ProjectionCheckpointRow>,
): Record<string, ProjectionCheckpointRow> {
  let text: string | undefined;
  try {
    text = JSON.stringify(rows);
  } catch (error) {
    throw new TypeError(
      `projection checkpoint is not losslessly JSON-serializable: ${String(error)}`,
      { cause: error },
    );
  }
  if (text === undefined) {
    throw new TypeError("projection checkpoint is not losslessly JSON-serializable");
  }
  return JSON.parse(text) as Record<string, ProjectionCheckpointRow>;
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
