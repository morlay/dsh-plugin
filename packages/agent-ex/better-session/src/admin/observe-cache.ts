// 冷会话观察缓存：按 (持久化实例身份, revision) 命中；租约 pin 住的条目不会被淘汰。
//
// 观测与点观测都在这里（它们共用同一份切面与租约）；查询行只负责把日志读给它。
import {
  Session,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionLogOffset,
  type SessionObservation,
  type SessionObservationOptions,
} from "@morlay/dsh-session/contract";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { SessionQueryError } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import type { SessionPersistenceRevision } from "@morlay/dsh-session-persistence/contract";

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

/** 观测缓存要的端口：读日志与刷盘是查询行的能力，缓存只管切面与租约。 */
export interface ObserveCacheDeps {
  persistence(): SessionPersistence;
  sessions(): SessionStore;
  projections(): SessionProjectionStore | undefined;
  cacheSize(): number;
  flushLive(id: SessionId): Promise<void>;
  loadLog(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{
    header: SessionHeader;
    inheritedEventCount: SessionLogOffset;
    events: readonly SessionEvent[];
  }>;
}

function notFound(sessionId: SessionId): SessionQueryError {
  return new SessionQueryError(
    "session " + String(sessionId) + " not found",
    "SESSION_QUERY_SESSION_NOT_FOUND",
  );
}

/**
 * 观测缓存：点观测与点观测（inspect）共用同一份切面与租约。
 * @param deps - 读日志 / 刷盘 / 容量。
 * @returns 观测方法（查询行转发）。
 */
export function createObserveCache(deps: ObserveCacheDeps) {
  const cache = new Map<SessionId, PreparedEntry>();

  /**
   * 点观测：一个不可变的切面 + 可再租借的租约（`retain`），用完 `Symbol.dispose` 归还。
   *
   * 切面按 `(persistenceIdentity, revision)` 缓存：同一个 revision 再来一次不重读日志（也不重做校验回放）；
   * 租约 `retain` 时 `refs++`，有租约的条目不会被淘汰——租约活着切面就一直有效。
   */
  async function observeSession(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    const { signal, projectionMode = "all" } = options;
    signal?.throwIfAborted();
    // live 也走库读：先排空 live 缓冲，再按落盘 revision 取切面（理由见 `设计 20261109-会话查询直读RDB读面`）。
    await deps.flushLive(sessionId);
    signal?.throwIfAborted();
    const live = deps.sessions().get(sessionId) !== undefined;
    const snapshot = await deps
      .persistence()
      .stat(sessionId, signal === undefined ? undefined : { signal });
    if (snapshot === undefined) throw notFound(sessionId);
    let entry = cachedEntry(deps.persistence().identity, sessionId, snapshot.revision);
    if (entry === undefined) {
      const loaded = await deps.loadLog(sessionId, signal);
      signal?.throwIfAborted();
      entry = {
        persistenceIdentity: deps.persistence().identity,
        revision: snapshot.revision,
        header: loaded.header,
        inheritedEventCount: loaded.inheritedEventCount,
        events: Object.freeze([...loaded.events]),
        refs: 0,
      };
      storePrepared(sessionId, entry);
    }
    const projectionStore = deps.projections();
    const projections =
      projectionMode === "none" || projectionStore === undefined
        ? undefined
        : projectionStore.snapshot(sessionOf(entry));
    return leaseOn(sessionId, entry, live, projections);
  }

  /**
   * 点观测（`inspectSession`）：不发布、不恢复 cold Session，只在切面上同步读一次。
   *
   * live 会话读内存里那一份（`observeSession` 已先 flush，库与内存一致）；cold 会话用
   * `sessions.prepare` 造一份**未入 store** 的 Session。`read` 不得修改或保留 Session——
   * 观察租约在读完之后释放，调用方只保留返回值（上游 `SessionQueryEngine.inspectSession` 的语义）。
   */
  const inspectSession = async <T>(
    sessionId: SessionId,
    read: (session: Session) => T,
    signal?: AbortSignal,
  ): Promise<T> => {
    const observation = await observeSession(sessionId, {
      projectionMode: "none",
      ...(signal === undefined ? {} : { signal }),
    });
    try {
      signal?.throwIfAborted();
      const live = deps.sessions().get(sessionId);
      if (live !== undefined) return read(live);
      try {
        return read(
          deps.sessions().prepare(observation.header.id, {
            seed: [...observation.events],
            meta: observation.header,
            inheritedEventCount: observation.inheritedEventCount,
            eventState: "detached",
          }),
        );
      } catch (error) {
        // 准备与读取之间会话被 attach：live 那一份是更新的来源，改读它（上游同一处理）。
        const attached = deps.sessions().get(sessionId);
        if (attached !== undefined) return read(attached);
        throw error;
      }
    } finally {
      observation[Symbol.dispose]();
    }
  };

  // 条目上的 detached Session 按需建：投影折叠要它，只读 header / 游标的消费方不必付这份代价。
  function sessionOf(entry: PreparedEntry): Session {
    entry.session ??= Session.create(
      entry.header.id,
      entry.events,
      entry.header,
      entry.inheritedEventCount,
      // 第五个参数是消息解释器：日志里有 `image/offload` 这类投影事件时，缺它构造就抛裸 Error。
      // 解释器的唯一 home 是会话存储的注册表（插件注册在它上面），这里照抄给 detached 会话。
      deps.sessions().messageProjections,
    );
    return entry.session;
  }

  // 命中同一 `(持久化实例身份, revision)` 才算命中；命中一次就移到队尾（LRU）。
  function cachedEntry(
    persistenceIdentity: symbol,
    sessionId: SessionId,
    revision: SessionPersistenceRevision,
  ): PreparedEntry | undefined {
    const cached = cache.get(sessionId);
    if (
      cached === undefined ||
      cached.persistenceIdentity !== persistenceIdentity ||
      cached.revision !== revision
    ) {
      return undefined;
    }
    cache.delete(sessionId);
    cache.set(sessionId, cached);
    return cached;
  }

  // 写入（或替换旧 revision 的条目）后按容量淘汰；旧条目只从表里摘掉，活着的租约自己握着它。
  function storePrepared(sessionId: SessionId, entry: PreparedEntry): void {
    cache.delete(sessionId);
    cache.set(sessionId, entry);
    evictPastCapacity(entry);
  }

  // 淘汰最旧的未 pin 条目；租约归还导致 refs 归零时也走一次，否则被 pin 满的缓存会一直超预算。
  function evictPastCapacity(keep?: PreparedEntry): void {
    const capacity = Math.max(1, deps.cacheSize());
    if (cache.size <= capacity) return;
    for (const [id, candidate] of cache) {
      if (candidate === keep || candidate.refs > 0) continue;
      cache.delete(id);
      if (cache.size <= capacity) return;
    }
  }

  // 一份租约：每次租借 `refs + 1`，归还到 0 时才有资格被淘汰。
  function leaseOn(
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
          if (entry.refs === 0) evictPastCapacity();
        },
      };
    };
    return lease();
  }

  return { observeSession, inspectSession };
}
