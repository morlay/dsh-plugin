// 会话查询（`sessionQuery` 那一行）：**直接实现契约，直接查我们自己的库**。
//
// 不继承上游的 `SessionQueryEngine`。理由：那个引擎自带一层语料视图（`SessionCorpus` +
// `SessionObservationReader`，后者还持有一份「完整 Session 对象」的有界缓存）——那是**第二份数据视图**，
// 与本包 `SessionPersistenceRdb` 的读路径（`readLog` + `repairReadView` + `validateStoredEvents`）重复。
// 同一个库里同一份事件读两遍、缓存两份，没有任何收益。
//
// 这一行的每件事都落在**已有的读面**上（取舍见 `设计 20261109-会话查询直读RDB读面`）：
// - 列表 / 归档：`SessionRdbStore.listRows` + live `SessionStore.list()`（live 优先，与上游同语义）；
// - 读日志：live 会话先 `sessions.flush`（库是唯一的 home），再 `SessionRdbStore.load`
//   （格式转换与读视图修复已在它里面做过）；
// - 事件记录 / 表面 / 轨迹 / 标题：上游的**纯函数**（无状态、不开连接），直接调；
// - 搜索：本装配没有全文索引，是**显式失败**（`SESSION_QUERY_SEARCH_DISABLED`），不是"搜到空"——
//   "搜到空"会让模型以为会话里没有这个词。
//
// 契约成员表仍是上游的（`@morlay/dsh-session` 的 `SessionQuery`，带覆盖守卫）：少一个成员编译期就报，
// 消费方（`api-session-controller` / `session-reference`）按它取用。
import {
  Session,
  type SessionEvent,
  type SessionHeader,
  SessionLogOffset,
  SessionSeq,
  interruptedTurnClosers,
  snapshotSessionEvent,
} from "@morlay/dsh-session/contract";
import type { SessionId } from "@morlay/dsh-session/contract";
import {
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
  buildSessionEventRecords,
  buildSessionEventSearchDocuments,
  extractSessionEventText,
  filterSessionEventDocuments,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from "@morlay/dsh-session/contract";
import { currentSurfaceEvents, traceEvent, traceSession } from "@morlay/dsh-session/contract";
import type {
  SessionEventReadRequest,
  SessionEventSearchDocument,
  SessionEventSearchPage,
  SessionEventTraceObservation,
  SessionEventWindow,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionEventRecord,
  SessionObservation,
  SessionObservationOptions,
  SessionRecord,
  SessionResultFilter,
  SessionSearchHit,
  SessionSearchPage,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from "@morlay/dsh-session/contract";
import { foldSessionTitle } from "@morlay/dsh-conversation";
import { asRdbStore } from "./contract/session-rdb-store.contract.ts";
import { rowToEvent, rowToMeta } from "./rdb/log/rows.ts";
import { eventFilterCondition, sessionFilterCondition } from "./rdb/query-filters.ts";
import { SessionProjectionStore, SessionQuery, SessionStore } from "@morlay/dsh-session";
import type { SessionPersistenceRevision } from "@morlay/dsh-session-persistence/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { inject, Injectable } from "@morlay/zephyr";

/** 一次完整读的结果（live 也一样：先 flush 再从库里读）。 */
interface LoadedLog {
  readonly header: SessionHeader;
  readonly inheritedEventCount: SessionLogOffset;
  readonly events: readonly SessionEvent[];
}

/**
 * 冷会话观察缓存的一条：同一 `(持久化实例身份, revision)` 的切面可重用。
 *
 * 条目持一份已经校验过的日志（以及按需建好的 detached Session，投影折叠在它上面做）；
 * 有租约 pin 住（`refs > 0`）的条目不淘汰——租约期间切面必须一直有效，哪怕更新的 revision 已经落库。
 */
interface PreparedEntry {
  readonly persistenceIdentity: symbol;
  readonly revision: SessionPersistenceRevision;
  readonly header: SessionHeader;
  readonly inheritedEventCount: SessionLogOffset;
  readonly events: readonly SessionEvent[];
  // 按需建：只要 header / 游标 / 事件、不要投影的消费方不必付一次全量折叠。
  session?: Session;
  refs: number;
}

/**
 * `sessionQuery` 那一行：列表 / 读取 / 观测 / 标题 / 轨迹，全部直接读本包的库。
 *
 * 可选服务一律 `inject.optional`：测试装配与 headless 下投影注册表可能缺席，缺席时观测仍给出
 * 日志与游标，只是没有 `projections`——上游语义也是"注册表没装就没有快照"。
 */
@Injectable()
export class SessionQueryRdb extends SessionQuery {
  // 可选服务（workspace registry）按名字在**调用时**读：装配里可能晚于本行挂载。
  private row: unknown;

  onInit(ctx: unknown): void {
    this.row = ctx;
  }

  private readonly sessions = inject(SessionStore);

  private readonly persistence = inject(SessionPersistence);

  private readonly projections = inject.optional(SessionProjectionStore);

  // 冷会话观察缓存：按 `(persistenceIdentity, revision)` 命中，容量来自落盘行。
  private readonly preparedCache = new Map<SessionId, PreparedEntry>();

  // 本行配置的冷会话观察缓存容量（落盘行透传；缺省 1）。
  get preparedSessionCacheSize(): number {
    return (
      (this.persistence as unknown as { preparedSessionCacheSize?: number })
        .preparedSessionCacheSize ?? 1
    );
  }

  // ---- 列表 ----

  /** 列表：live 覆盖落库行，按创建时间倒序、id 升序（与上游 `compareSessions` 同序）。 */
  async listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    signal?.throwIfAborted();
    const records = new Map<string, SessionRecord>();
    const snapshots = await this.persistence.list(signal === undefined ? undefined : { signal });
    for (const snapshot of snapshots) {
      records.set(String(snapshot.header.id), {
        header: structuredClone(snapshot.header),
        live: false,
        persisted: true,
        ...(snapshot.formatStatus === undefined ? {} : { formatStatus: snapshot.formatStatus }),
      });
    }
    signal?.throwIfAborted();
    for (const live of this.sessions.list()) {
      const durable = records.get(String(live.id));
      records.set(String(live.id), {
        header: structuredClone(live.header),
        live: true,
        persisted: durable !== undefined,
        formatStatus: "current",
      });
    }
    const ordered = [...records.values()].sort(
      (a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id),
    );
    // 归档是「收起来」的会话：完整语料走管理面 `sessionAdmin/rows`（那里读 `listRows`，不过这里）。
    const archived = await this.archivedSessionIds();
    if (archived.size === 0) return ordered;
    return ordered.filter((record) => !archived.has(String(record.header.id)));
  }

  // 归档集合：优先读 workspace registry（它与页面上的归档动作同源）；registry 不在（headless / 启动早期 /
  // 测试装配）就退回持久化里的归档标记——"官方列表不含已归档"是这一层的语义，不能因为一个可选服务没到
  // 就把归档会话又列出来。
  private async archivedSessionIds(): Promise<ReadonlySet<string>> {
    const registry = (
      this.row as unknown as { get(n: string, s?: boolean): unknown } | undefined
    )?.get("workspaceRegistry", false) as { archivedSessionIds?: readonly string[] } | undefined;
    if (registry !== undefined) return new Set<string>(registry.archivedSessionIds ?? []);
    return await asRdbStore(this.persistence).archivedSessionIds();
  }

  // 筛选下推到 SQL：id / cwd / parent / createdAt 进 WHERE，只取命中的行。
  //
  // availability 不是列（live 是进程内事实、persisted 是"行存在"），所以按来源分流：要 persisted 才查库、
  // 要 live 才遍历 live 表；两者都要时取并集。归档过滤与排序仍在内存里做——它们是"这一层"的语义，不是列。
  async filterSessions(
    filters: Parameters<SessionQuery["filterSessions"]>[0],
    signal?: AbortSignal,
  ): Promise<SessionRecord[]> {
    signal?.throwIfAborted();
    const materialized = materializeSessionResultFilters(filters);
    const wants = availabilityOf(materialized);
    if (!wants.live && !wants.persisted) return [];
    const records = new Map<string, SessionRecord>();
    if (wants.persisted) {
      const store = asRdbStore(this.persistence);
      const rows = await store.selectSessionRows(
        sessionFilterCondition(materialized, store.sessionFilterColumns()),
      );
      signal?.throwIfAborted();
      for (const row of rows) {
        records.set(row.fSessionId, { header: rowToMeta(row), live: false, persisted: true });
      }
    }
    if (wants.live) {
      for (const live of this.sessions.list()) {
        const durable = records.get(String(live.id));
        records.set(String(live.id), {
          header: structuredClone(live.header),
          live: true,
          persisted: durable !== undefined,
          formatStatus: "current",
        });
      }
    }
    const archived = await this.archivedSessionIds();
    const accepted = [...records.values()].filter(
      (record) => archived.size === 0 || !archived.has(String(record.header.id)),
    );
    return accepted.sort(
      (a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id),
    );
  }

  // ---- 读日志 ----

  /** 读一次完整日志并按上游语义回放校验（`Session.create` 在重建时抛错就是坏日志）。 */
  async readSession(sessionId: SessionId): Promise<SessionLogSnapshot> {
    const loaded = await this.loadLog(sessionId);
    Session.create(sessionId, loaded.events, loaded.header, loaded.inheritedEventCount);
    return {
      session: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      events: loaded.events.map(snapshotSessionEvent),
    };
  }

  /**
   * 一次完整日志：**只有库这一条读路径**。
   *
   * live 会话先把内存缓冲排空（`session/flush` 是上游的公开同步点，落盘行在它里面等写句柄排空），
   * 再从库里读——一个事实只有一个 home（见 `设计 20261109-会话查询直读RDB读面`）。冷读补上中断轮次的
   * 闭合事件（与上游 cold read 同一个"平衡日志"口径）。
   */
  private async loadLog(sessionId: SessionId, signal?: AbortSignal): Promise<LoadedLog> {
    await this.flushLive(sessionId);
    const loaded = await asRdbStore(this.persistence).load(String(sessionId), signal);
    const events = [...loaded.events];
    return {
      header: loaded.meta,
      inheritedEventCount: SessionLogOffset(loaded.inheritedEventCount),
      events: [...events, ...interruptedTurnClosers(events)],
    };
  }

  // live 会话的落库同步点：这一步之后库里的日志才等于内存里的日志。
  private async flushLive(sessionId: SessionId): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (live !== undefined) await this.sessions.flush(live);
  }

  // ---- 标题 ----

  async readTitle(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionTitleObservation["title"]> {
    return (await this.readTitleSnapshot(sessionId, signal)).title;
  }

  async readTitleSnapshot(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionTitleObservation> {
    const [result] = await this.readTitleSnapshots([sessionId], signal);
    if (result === undefined) throw notFound(sessionId);
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }

  async readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]> {
    // 逐个独立结算：一个会话读失败不连坐其它会话（上游 `projectMany` 同语义）；取消则整体抛。
    const seen = new Set<string>();
    const results: SessionTitleObservationResult[] = [];
    for (const sessionId of sessionIds) {
      if (seen.has(String(sessionId))) continue;
      seen.add(String(sessionId));
      try {
        const loaded = await this.loadLog(sessionId, signal);
        const title = foldSessionTitle(loaded.events);
        results.push({
          sessionId,
          status: "fulfilled",
          value: {
            session: structuredClone(loaded.header),
            ...(title === undefined ? {} : { title }),
          },
        });
      } catch (error) {
        signal?.throwIfAborted();
        results.push({ sessionId, status: "rejected", reason: error });
      }
    }
    return results;
  }

  // ---- 事件 ----

  // 事件列表：只取 (seq, type, time, surfaceOp) 四列，不物化任何事件 JSON。
  //
  // surface 两态在这里就能算：会话里没有 replace 时"有 surfaceOp 就是 current，否则 log-only"；
  // 有 replace 才需要读全量日志折叠（那时读的代价是判据要求，不是这里偷懒）。
  async listEvents(sessionId: SessionId): Promise<ReturnType<typeof buildSessionEventRecords>> {
    return await this.loadEventsForRecords(sessionId);
  }

  // 记录来源：没有 replace 的会话按四列坐标直接拼（不读 f_data）；有 replace 才读全量折叠。
  private async loadEventsForRecords(
    sessionId: SessionId,
  ): Promise<ReturnType<typeof buildSessionEventRecords>> {
    const id = String(sessionId);
    await this.flushLive(sessionId);
    const readModel = asRdbStore(this.persistence).readModel();
    if (await readModel.hasSurfaceReplace(id)) {
      return buildSessionEventRecords(sessionId, (await this.loadLog(sessionId)).events);
    }
    const metas = await readModel.selectEventMetas(id);
    return metas.map((meta) => ({
      sessionId,
      seq: SessionSeq(meta.seq),
      type: meta.type as SessionEventRecord["type"],
      time: meta.time,
      surface: meta.surfaceOp === null ? "log-only" : "current",
    }));
  }

  // 事件筛选：seq / time / type 进 WHERE，只物化命中的那几行；text 与 surface 在命中的行上再判。
  //
  // surface 分类要看**整段日志**（`foldSurface` 要求从 seq 0 连续，命中行单独折会直接报"不连续"），
  // 所以分类来自全量坐标（`selectEventMetas`：只有四列，不读 f_data），文本抽取只对命中行做。
  // 有 replace 的会话例外：谁覆盖了谁是折叠结果，只能读全量日志再筛（与上游同代价）。
  async filterEvents(
    sessionId: SessionId,
    filters: Parameters<SessionQuery["filterEvents"]>[1],
  ): Promise<SessionEventSearchDocument[]> {
    const materialized = materializeSessionEventResultFilters(filters);
    const store = asRdbStore(this.persistence);
    const id = String(sessionId);
    await this.flushLive(sessionId);
    const readModel = store.readModel();
    if (await readModel.hasSurfaceReplace(id)) {
      const loaded = await this.loadLog(sessionId);
      return filterSessionEventDocuments(
        buildSessionEventSearchDocuments(sessionId, loaded.events),
        materialized,
      );
    }
    const current = currentSurfaceSeqs(await readModel.selectEventMetas(id));
    const rows = await store.selectEventRows(
      id,
      eventFilterCondition(materialized, store.eventFilterColumns()),
    );
    const documents = rows.flatMap((row) => {
      const document = searchDocumentOf(sessionId, rowToEvent(row), current);
      return document === undefined ? [] : [document];
    });
    return filterSessionEventDocuments(documents, materialized);
  }

  async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot> {
    const loaded = await this.loadLog(sessionId);
    return {
      session: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      capturedThroughSeq: loaded.events.at(-1)?.seq ?? null,
      events: currentSurfaceEvents(sessionId, loaded.events),
    };
  }

  // ---- 轨迹 ----

  async traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace> {
    return traceSession(await this.listSessions(signal), sessionId);
  }

  async traceEvent(
    request: Parameters<SessionQuery["traceEvent"]>[0],
    signal?: AbortSignal,
  ): Promise<SessionEventTraceObservation> {
    const loaded = await this.loadLog(request.sessionId, signal);
    signal?.throwIfAborted();
    return {
      session: loaded.header,
      ...traceEvent(request.sessionId, loaded.events, request.seq),
    };
  }

  async readEvent(
    request: SessionEventReadRequest,
    signal?: AbortSignal,
  ): Promise<SessionEventWindow> {
    const before = readWindow("before", request.before);
    const after = readWindow("after", request.after);
    const loaded = await this.loadLog(request.sessionId, signal);
    signal?.throwIfAborted();
    const seq = request.seq;
    const target = loaded.events[seq];
    if (target === undefined || target.seq !== seq) {
      throw new SessionQueryError(
        `session "${String(request.sessionId)}" has no event at seq ${String(seq)}`,
        "SESSION_QUERY_EVENT_NOT_FOUND",
      );
    }
    const startSeq = SessionSeq(Math.max(0, seq - before));
    const endSeq = SessionSeq(Math.min(loaded.events.length - 1, seq + after));
    const targetSnapshot = snapshotSessionEvent(target);
    return {
      session: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      target: targetSnapshot,
      events: loaded.events
        .slice(startSeq, endSeq + 1)
        .map((event) => (event === target ? targetSnapshot : snapshotSessionEvent(event))),
      startSeq,
      endSeq,
    };
  }

  // ---- 观测 ----

  /**
   * 点观测：一个不可变的切面 + 可再租借的租约（`retain`），用完 `Symbol.dispose` 归还。
   *
   * 切面按 `(persistenceIdentity, revision)` 缓存：同一个 revision 再来一次不重读日志（也不重做校验回放）；
   * 租约 `retain` 时 `refs++`，有租约的条目不会被淘汰——租约活着切面就一直有效。
   */
  async observeSession(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    const { signal, projectionMode = "all" } = options;
    signal?.throwIfAborted();
    // live 也走库读：先排空 live 缓冲，再按落盘 revision 取切面（理由见 `设计 20261109-会话查询直读RDB读面`）。
    await this.flushLive(sessionId);
    signal?.throwIfAborted();
    const live = this.sessions.get(sessionId) !== undefined;
    const snapshot = await this.persistence.stat(
      sessionId,
      signal === undefined ? undefined : { signal },
    );
    if (snapshot === undefined) throw notFound(sessionId);
    let entry = this.cachedEntry(this.persistence.identity, sessionId, snapshot.revision);
    if (entry === undefined) {
      const loaded = await this.loadLog(sessionId, signal);
      signal?.throwIfAborted();
      entry = {
        persistenceIdentity: this.persistence.identity,
        revision: snapshot.revision,
        header: loaded.header,
        inheritedEventCount: loaded.inheritedEventCount,
        events: Object.freeze([...loaded.events]),
        refs: 0,
      };
      this.storePrepared(sessionId, entry);
    }
    const projections =
      projectionMode === "none" || this.projections === undefined
        ? undefined
        : this.projections.snapshot(this.sessionOf(entry));
    return this.leaseOn(sessionId, entry, live, projections);
  }

  /**
   * 点观测（`inspectSession`）：不发布、不恢复 cold Session，只在切面上同步读一次。
   *
   * live 会话读内存里那一份（`observeSession` 已先 flush，库与内存一致）；cold 会话用
   * `sessions.prepare` 造一份**未入 store** 的 Session。`read` 不得修改或保留 Session——
   * 观察租约在读完之后释放，调用方只保留返回值（上游 `SessionQueryEngine.inspectSession` 的语义）。
   */
  inspectSession = async <T>(
    sessionId: SessionId,
    read: (session: Session) => T,
    signal?: AbortSignal,
  ): Promise<T> => {
    const observation = await this.observeSession(sessionId, {
      projectionMode: "none",
      ...(signal === undefined ? {} : { signal }),
    });
    try {
      signal?.throwIfAborted();
      const live = this.sessions.get(sessionId);
      if (live !== undefined) return read(live);
      try {
        return read(
          this.sessions.prepare(observation.header.id, {
            seed: [...observation.events],
            meta: observation.header,
            inheritedEventCount: observation.inheritedEventCount,
            eventState: "detached",
          }),
        );
      } catch (error) {
        // 准备与读取之间会话被 attach：live 那一份是更新的来源，改读它（上游同一处理）。
        const attached = this.sessions.get(sessionId);
        if (attached !== undefined) return read(attached);
        throw error;
      }
    } finally {
      observation[Symbol.dispose]();
    }
  };

  // 条目上的 detached Session 按需建：投影折叠要它，只读 header / 游标的消费方不必付这份代价。
  private sessionOf(entry: PreparedEntry): Session {
    entry.session ??= Session.create(
      entry.header.id,
      entry.events,
      entry.header,
      entry.inheritedEventCount,
    );
    return entry.session;
  }

  // 命中同一 `(持久化实例身份, revision)` 才算命中；命中一次就移到队尾（LRU）。
  private cachedEntry(
    persistenceIdentity: symbol,
    sessionId: SessionId,
    revision: SessionPersistenceRevision,
  ): PreparedEntry | undefined {
    const cached = this.preparedCache.get(sessionId);
    if (
      cached === undefined ||
      cached.persistenceIdentity !== persistenceIdentity ||
      cached.revision !== revision
    ) {
      return undefined;
    }
    this.preparedCache.delete(sessionId);
    this.preparedCache.set(sessionId, cached);
    return cached;
  }

  // 写入（或替换旧 revision 的条目）后按容量淘汰；旧条目只从表里摘掉，活着的租约自己握着它。
  private storePrepared(sessionId: SessionId, entry: PreparedEntry): void {
    this.preparedCache.delete(sessionId);
    this.preparedCache.set(sessionId, entry);
    this.evictPastCapacity(entry);
  }

  // 淘汰最旧的未 pin 条目；租约归还导致 refs 归零时也走一次，否则被 pin 满的缓存会一直超预算。
  private evictPastCapacity(keep?: PreparedEntry): void {
    const capacity = Math.max(1, this.preparedSessionCacheSize);
    if (this.preparedCache.size <= capacity) return;
    for (const [id, candidate] of this.preparedCache) {
      if (candidate === keep || candidate.refs > 0) continue;
      this.preparedCache.delete(id);
      if (this.preparedCache.size <= capacity) return;
    }
  }

  // 一份租约：每次租借 `refs + 1`，归还到 0 时才有资格被淘汰。
  private leaseOn(
    sessionId: SessionId,
    entry: PreparedEntry,
    live: boolean,
    projections: SessionObservation["projections"],
  ): SessionObservation {
    entry.refs += 1;
    const lease = (): SessionObservation => {
      let disposed = false;
      return {
        source: live ? "live" : "prepared",
        header: structuredClone(entry.header),
        inheritedEventCount: entry.inheritedEventCount,
        events: entry.events,
        cursor: SessionSeq(entry.events.at(-1)?.seq ?? -1),
        revision: entry.revision,
        ...(projections === undefined ? {} : { projections }),
        retain: () => {
          if (disposed) throw new Error(`session observation "${String(sessionId)}" is disposed`);
          entry.refs += 1;
          return lease();
        },
        [Symbol.dispose]: () => {
          if (disposed) return;
          disposed = true;
          entry.refs -= 1;
          if (entry.refs === 0) this.evictPastCapacity();
        },
      };
    };
    return lease();
  }

  // ---- 搜索 ----

  searchSessions(): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.reject(searchDisabled());
  }

  searchEvents(): Promise<SessionEventSearchPage> {
    return Promise.reject(searchDisabled());
  }
}

/**
 * 来源分流：`availability` 不是列（live 是进程内事实、persisted 是"行存在"）。
 *
 * @param filters - 已 materialize 的会话筛选条件。
 * @returns 要查库（persisted）与要遍历 live 表（live）两个开关；没有该条件时两者都要（不过滤=并集）。
 */
function availabilityOf(filters: readonly SessionResultFilter[]): {
  readonly live: boolean;
  readonly persisted: boolean;
} {
  let live = true;
  let persisted = true;
  for (const filter of filters) {
    if (filter.kind !== "availability") continue;
    live = filter.values.includes("live");
    persisted = filter.values.includes("persisted");
  }
  return { live, persisted };
}

/**
 * 没有 replace 的会话里，哪些 seq 是当前 surface 节点：带 `f_surface_op` 的那几行（append 即 current）。
 *
 * @param metas - 全量事件坐标（`selectEventMetas`：不含 `f_data`）。
 * @returns current 节点的 seq 集合。
 */
function currentSurfaceSeqs(
  metas: ReadonlyArray<{ seq: number; surfaceOp: string | null }>,
): ReadonlySet<number> {
  const seqs = new Set<number>();
  for (const meta of metas) if (meta.surfaceOp !== null) seqs.add(meta.seq);
  return seqs;
}

/**
 * 一条命中的事件行 → 搜索文档（与上游 `buildSessionEventSearchDocuments` 同一判据：没有语义文本就不收）。
 *
 * @param sessionId - 会话身份。
 * @param event - 命中的事件（`rowToEvent` 已解析 `f_data`）。
 * @param current - current surface 节点的 seq 集合。
 * @returns 文档；事件没有可检索文本时 undefined。
 */
function searchDocumentOf(
  sessionId: SessionId,
  event: SessionEvent,
  current: ReadonlySet<number>,
): SessionEventSearchDocument | undefined {
  const text = extractSessionEventText(event);
  if (text.length === 0) return undefined;
  return {
    sessionId,
    seq: event.seq,
    type: event.type,
    time: event.time,
    surface: current.has(event.seq) ? "current" : "log-only",
    text,
  };
}

/** 一次搜索被拒的理由：本装配没有全文索引，搜索是显式失败而不是空结果。 */
function searchDisabled(): SessionQueryError {
  return new SessionQueryError(
    "session search is disabled: this deployment serves session queries from the rdb backend without a full-text index",
    "SESSION_QUERY_SEARCH_DISABLED",
  );
}

function notFound(sessionId: SessionId): SessionQueryError {
  return new SessionQueryError(
    `session "${String(sessionId)}" not found`,
    "SESSION_QUERY_SESSION_NOT_FOUND",
  );
}

/** 读窗口：省略是 0，越界或非整数显式报错（与上游同一个上限）。 */
function readWindow(name: "before" | "after", value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > SESSION_QUERY_READ_WINDOW_MAX) {
    throw new SessionQueryError(
      `${name} must be an integer between 0 and ${String(SESSION_QUERY_READ_WINDOW_MAX)}`,
      "SESSION_QUERY_INVALID_WINDOW",
    );
  }
  return value;
}
