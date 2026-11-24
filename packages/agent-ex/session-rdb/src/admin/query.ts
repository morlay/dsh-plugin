// 会话查询（sessionQuery 那一行）：直接实现契约，直接查我们自己的库。
//
// 观测缓存与筛选条件各有自己的文件（observe-cache / filters）；这里只保留查询行本身。
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
  SessionListMetadata,
  SessionLogSnapshot,
  SessionEventRecord,
  SessionObservation,
  SessionObservationOptions,
  SessionRecord,
  SessionSearchHit,
  SessionSearchPage,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from "@morlay/dsh-session/contract";
import { foldSessionTitle } from "@morlay/dsh-conversation";
import { asRdbStore } from "../contract/session-rdb-store.contract.ts";
import { rowToEvent, rowToMeta } from "../data/store/log/rows.ts";
import { eventFilterCondition, sessionFilterCondition } from "./filters.ts";
import { SessionProjectionStore, SessionQuery, SessionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { inject, Injectable } from "@morlay/zephyr";

import { createObserveCache } from "./observe-cache.ts";

/** 一次完整读的结果（live 也一样：先 flush 再从库里读）。 */
interface LoadedLog {
  readonly header: SessionHeader;
  readonly inheritedEventCount: SessionLogOffset;
  readonly events: readonly SessionEvent[];
}
import { availabilityOf, currentSurfaceSeqs, searchDocumentOf } from "./filters.ts";

/**
 * `sessionQuery` 那一行：列表 / 读取 / 观测 / 标题 / 轨迹，全部直接读本包的库。
 *
 * 可选服务一律 `inject.optional`（契约令牌，不按字符串名字取）：测试装配与 headless 下投影注册表可能缺席，
 * 缺席时观测仍给出日志与游标，只是没有 `projections`——上游语义也是"注册表没装就没有快照"。
 * 代价与 `admin/store.ts` 同一个：提供者要排在会话行之前（zephyr 的 `optional` 参与装配排序）。
 *
 * **归档集合不从 workspace 域读**：那一行反过来注入本行的持久化，注入边成环会把 workspace 行排到
 * 本行之前（它在 init 里就 `storageDomain.open("workspace")`，那会儿 `rdb` 还没注册）。归档标记本来就
 * 落在 workspace 域的同一份存储里，本行的 `archivedSessionIds()` 直接读它——**同一份数据**，少一条边。
 */
@Injectable()
export class SessionQueryRdb extends SessionQuery {
  private readonly sessions = inject(SessionStore);

  private readonly persistence = inject(SessionPersistence);

  private readonly projections = inject.optional(SessionProjectionStore);

  // 冷会话观察缓存：按 `(persistenceIdentity, revision)` 命中，容量来自落盘行。

  // 冷会话观察缓存容量（源包同名字段：查询行按它建缓存）。
  get preparedSessionCacheSize(): number {
    return (
      (this.persistence as unknown as { preparedSessionCacheSize?: number })
        .preparedSessionCacheSize ?? 1
    );
  }

  private readonly observe = createObserveCache({
    persistence: () => this.persistence,
    sessions: () => this.sessions,
    projections: () => this.projections,
    cacheSize: () => this.preparedSessionCacheSize,
    flushLive: (id) => this.flushLive(id),
    loadLog: (id, signal) => this.loadLog(id, signal),
  });

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
    //
    // **空白会话不过滤**：上游 0.2.3 的 `session/list` 也返回它们（界面上就出现没有名字的条目）。
    // 本层保持「列出全部可见会话」的语义（`session-query.spec` 钉着 live + persisted 都在）；
    // 要不要在展示层藏掉空白，是装配 / UI 的决定，不在这条查询上。
    const archived = await this.archivedSessionIds();
    if (archived.size === 0) return ordered;
    return ordered.filter((record) => !archived.has(String(record.header.id)));
  }

  // 归档集合：**与页面上的归档动作同源**——归档动作写在 workspace 域的存储里，本行读的就是那份
  // （`asRdbStore().archivedSessionIds()` 读的是同一个 `workspace` 域状态）。所以这里不注入 workspace 域，
  // 免得注入边成环把 workspace 行排到本行之前（见文件头）。
  private async archivedSessionIds(): Promise<ReadonlySet<string>> {
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
    // 只有冷读配平（与上游 `corpus.load` 同形）：live 会话的轮次可能正开着，补 closer 等于把正在跑的
    // 轮次读成「已中断闭合」，`cursor` 还会越过库 head。冷读的写者已经没了，尾部未闭合就是中断。
    const live = this.sessions.get(sessionId) !== undefined;
    return {
      header: loaded.meta,
      inheritedEventCount: SessionLogOffset(loaded.inheritedEventCount),
      events: live ? events : [...events, ...interruptedTurnClosers(events)],
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

  // ---- 观测（切面与租约在 ./observe-cache.ts）----

  observeSession(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    return this.observe.observeSession(sessionId, options);
  }

  /**
   * 列表用的元数据：是否还没有 turn，以及最近一条人工提示词的时间（上游 0.2.3 新增的成员，
   * 取代了已下线的 `inspectSession`）。
   *
   * 上游用 `sessionListMetadata` 投影折叠——那是 `session-query-sqlite` 在自己 init 里注册的；RDB 装配
   * 不注册它，所以这里读投影缓存，没有缓存时给上游的 init 值。本仓不挂上游 `tool-session-list`
   * （唯一消费方），因此没有"读到默认值"的消费路径；将来挂它时得在这里注册那份投影定义。
   * @param session - 实时或已准备的 Session。
   * @returns 空白标记与最近人工提示词时间（无则 `null`）。
   */
  getListMetadata(session: Session): SessionListMetadata {
    const cached = this.projections?.cachedSnapshot(session)?.values["sessionListMetadata"];
    return cached === undefined ? { blank: true, lastPromptAt: null } : cached;
  }

  searchSessions(): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.reject(searchDisabled());
  }

  searchEvents(): Promise<SessionEventSearchPage> {
    return Promise.reject(searchDisabled());
  }
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
