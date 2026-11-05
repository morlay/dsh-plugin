import {
  SESSION_FORMAT_VERSION,
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
} from "@morlay/dsh-session/contract";
import type { SessionPersistenceSnapshot } from "@morlay/dsh-session-persistence/contract";
import {
  SessionBranchError,
  balanceRewindPrefix,
  rewindKeepLength,
  type BranchAnchorMode,
  type BranchBoundary,
  type ForkFromOptions,
} from "@morlay/better-session/endpoint";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionStore } from "@morlay/dsh-session";
import { SessionAgentControl } from "../../contract/session-agent-control.contract.ts";
import { SessionBranch } from "../../contract/session-branch.contract.ts";
import { asRdbStore } from "../../contract/session-rdb-store.contract.ts";
import { inject, Injectable, Logger, type Context, type OnInit } from "@morlay/zephyr";
import { resetDerivedState, type DerivedStateResetDeps } from "./reset.ts";
import { isLegacyVersion } from "../legacy.ts";
import type { BranchPort } from "./port.ts";
import { rowToEvent, rowToMeta } from "../log/rows.ts";

import { assertRewindBoundary, locateTurnEnd, mintSessionId, renumber } from "./semantics.ts";

export { locateTurnEnd } from "./semantics.ts";

export interface LiveSessionHooks {
  getSession(id: SessionId): Session | undefined;

  getAgent(id: SessionId): LiveAgentLike | undefined;

  flush(session: Session): Promise<boolean>;

  warn?(message: string): void;

  resetProjections?(session: Session): void;

  resetTokenMeter?(session: Session): void;

  refreshProjectionCache?(session: ProjectionCacheSession): Promise<void>;
}

export interface SessionBranchProvider {
  readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: BranchAnchorMode,
    signal?: AbortSignal,
  ): Promise<BranchBoundary>;

  readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>;

  forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId>;

  rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot>;
}

export interface ProjectionCacheSession {
  readonly id: SessionId;
  readonly header: SessionHeader;
  readonly inheritedEventCount: SessionLogOffset;

  // 没有 live 会话时（cold rewind）缓存按这个新水位截断，不 fold 日志
  readonly headSeq?: number;
  snapshotEvents(): readonly SessionEvent[];
}

export interface LiveAgentLike {
  session: Session;

  requestHeaderLogged?: boolean;

  inbox?: { clear(): void };
}

interface SurfaceManagerLike {
  _state: {
    nodes: number[];
    replaceGeneration: number;
    contentGeneration: number;
    projectedMessages: Map<unknown, unknown>;
  };
  _lastProcessedSeq: number;
  _pendingPlan?: unknown;
  baseSeq: number;
}

function resetSurfaceManager(surfaceManager: SurfaceManagerLike): void {
  const state = surfaceManager._state;
  state.nodes = [];
  state.replaceGeneration = 0;
  state.contentGeneration = 0;
  state.projectedMessages = new Map();
  surfaceManager._lastProcessedSeq = surfaceManager.baseSeq - 1;
  surfaceManager._pendingPlan = undefined;
}

/**
 * 会话**当前内存 log** 的快照（复制一份）。用于"需要完整序列"的操作（首次落库的 seed、rewind / fork 的历史），
 * 不走已弃用的同步历史读 `snapshotEvents()`——那三个读口上游已声明「新调用禁止」，而这里要的是当前内存里
 * 那份完整日志，不是按需分页的历史。
 * @param session - 会话。
 * @returns 事件副本（调用方可以自由遍历）。
 */
export function liveEventsOf(session: Session): readonly SessionEvent[] {
  return [...(session as unknown as { log: readonly SessionEvent[] }).log];
}

/** @returns 截断后日志里最后一个 `turn/start` 的 turn 号（没有则 0）。 */
export function truncateLiveSession(session: Session, newLength: number): number {
  const s = session as unknown as {
    log: SessionEvent[];
    eventsSnapshot?: unknown;
    headerFold?: unknown;
    headerFoldSeq: number;
    contextFold?: unknown;
    contextFoldSeq: number;
    derived: unknown[];
    derivedNodes: number;
    derivedGeneration: number;
    surfaceManager: SurfaceManagerLike;
  };
  // 截断后 agent 的 turn 游标要跟着落在保留前缀的最后一个 turn 上：这里直接读**要保留的那段**（同一个数组，
  // 不经过已弃用的同步历史读 `snapshotEvents`，也不依赖 agent 侧的投影）。
  const lastTurn =
    s.log.slice(0, newLength).findLast((event) => event.type === "turn/start")?.data.turn ?? 0;
  s.log.length = newLength;
  s.eventsSnapshot = undefined;
  s.headerFold = undefined;
  s.headerFoldSeq = 0;
  s.contextFold = undefined;
  s.contextFoldSeq = 0;
  s.derived = [];
  s.derivedNodes = 0;
  s.derivedGeneration = 0;
  resetSurfaceManager(s.surfaceManager);
  return lastTurn;
}

export function replaceLiveSessionLog(session: Session, events: readonly SessionEvent[]): void {
  const s = session as unknown as {
    log: SessionEvent[];
    eventsSnapshot?: unknown;
    headerFold?: unknown;
    headerFoldSeq: number;
    contextFold?: unknown;
    contextFoldSeq: number;
    derived: unknown[];
    derivedNodes: number;
    derivedGeneration: number;
    surfaceManager: SurfaceManagerLike;
  };
  s.log.length = 0;
  s.log.push(...events);
  s.eventsSnapshot = undefined;
  s.headerFold = undefined;
  s.headerFoldSeq = 0;
  s.contextFold = undefined;
  s.contextFoldSeq = 0;
  s.derived = [];
  s.derivedNodes = 0;
  s.derivedGeneration = 0;
  resetSurfaceManager(s.surfaceManager);
}

export class SessionBranchRdbProvider implements SessionBranchProvider {
  readonly name = "session-rdb";

  constructor(
    private readonly port: BranchPort,

    private readonly live: LiveSessionHooks = {
      getSession: () => undefined,
      getAgent: () => undefined,
      flush: async () => true,
    },
  ) {}

  async readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode: BranchAnchorMode = "after",
    signal?: AbortSignal,
  ): Promise<BranchBoundary> {
    const { events } = await this.readRawEvents(id, signal);
    const boundary = locateTurnEnd(events, atSeq, mode);
    return { seq: boundary, events: events.slice(0, boundary + 1) };
  }

  async readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
    const stored = await this.port.readLog(id, {}, signal);
    if (stored === undefined)
      throw new SessionBranchError(`session "${id}" not found`, "SESSION_NOT_FOUND");
    return { meta: stored.meta, events: stored.events };
  }

  async forkFrom(
    sourceId: SessionId,
    options: ForkFromOptions = {},
    signal?: AbortSignal,
  ): Promise<SessionId> {
    signal?.throwIfAborted();
    const { atSeq, anchorMode = "after", seedSuffix = [], childSessionId, meta = {} } = options;
    const source = await this.port.readLog(sourceId, {}, signal);
    if (source === undefined)
      throw new SessionBranchError(`session "${sourceId}" not found`, "SESSION_NOT_FOUND");
    const boundary = locateTurnEnd(source.events, atSeq, anchorMode);
    const prefix = balanceRewindPrefix(source.events.slice(0, boundary + 1));
    if (prefix.length <= boundary) {
      this.live.warn?.(
        `session-rdb: fork "${sourceId}" dropped ${boundary + 1 - prefix.length} trailing event(s) from seq ${prefix.length} to keep the seed's step pairs balanced`,
      );
    }
    const childId = childSessionId ?? mintSessionId();
    const childMeta: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: childId,
      createdAt: meta.createdAt ?? Date.now(),
      ...(meta.cwd !== undefined
        ? { cwd: meta.cwd }
        : source.meta.cwd !== undefined
          ? { cwd: source.meta.cwd }
          : {}),
      parentSession: sourceId,
      isSeeded: true,
      ...(meta.agentPreset !== undefined
        ? { agentPreset: meta.agentPreset }
        : source.meta.agentPreset !== undefined
          ? { agentPreset: source.meta.agentPreset }
          : {}),
      ...(meta.origin !== undefined ? { origin: meta.origin } : {}),
      ...(meta.delegationDepth !== undefined ? { delegationDepth: meta.delegationDepth } : {}),
    };
    const seed = [...renumber(prefix, 0), ...renumber(seedSuffix, prefix.length)];

    await this.port.ready;
    // 复用父会话的事件行有个前提：**读取视图的 seq 与存储行的 f_sequence 一一对应**。legacy 会话的读视图
    // 由迁移链重建（可能重新编号、增删事件），按 seq 复用会把桥接行挂到语义不符的行上——读取时按 `f_data`
    // 解析，子会话前缀读到的内容就会和它自己的 seed 事件对不上。那种情况下复制事件行（多几行存储，正确优先）。
    const reusable = !source.migrated && source.events.length === source.storedCount;
    const reuse = new Map<number, string>();
    if (reusable) {
      const sourceRows = await this.port.eventRows(sourceId);
      const sourceEventIds = new Map(sourceRows.map((row) => [row.fSequence, row.fEventId]));
      for (const event of prefix) {
        const eventId = sourceEventIds.get(event.seq);
        if (eventId !== undefined) reuse.set(event.seq, eventId);
      }
    } else if (prefix.length > 0) {
      this.live.warn?.(
        `session-rdb: fork "${sourceId}" copies event rows instead of reusing them — its read view comes from a migration, so stored seqs need not line up`,
      );
    }
    this.port.registerReuseEventIds(childId, reuse);
    try {
      const handle = await this.port.create(childMeta, {
        inheritedEventCount: SessionLogOffset(prefix.length),
      });
      try {
        if (seed.length > 0) await handle.append(seed);
      } finally {
        await handle.close();
      }
    } catch (error) {
      // fork 没成（id 已存在、append 失败等）：别把复用映射留在进程里——同一个 childId 之后的落写会按它
      // 去复用父会话的事件行，而那条会话可能完全无关。
      this.port.dropReuseEventIds(childId);
      throw error;
    }
    // fork 不动统计：继承前缀的消耗是父会话真实发生的那一次，子会话只记自己新产生的
    // （写路径旁路累加，见 ADR-fork不继承统计）。
    return childId;
  }

  async rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot> {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(toBoundary) || toBoundary < -1) {
      throw new SessionBranchError(
        `rewind boundary must be a non-negative safe integer, got ${toBoundary}`,
        "INVALID_BOUNDARY",
      );
    }
    const live = this.live.getSession(id);

    if (live !== undefined) await this.live.flush(live);

    await this.port.ready;

    // SessionBranch 是「先停止、再操作」的排他面（ADR-rewind绕过handle模型直接截断）：rewind 直连 DB 做最小工作，
    // 不走持久化抽象的全量读路径（readLog 会拉全部事件 + legacy 转换 + 读视图修复）。
    const row = await this.port.sessionRow(id);
    if (row === undefined) {
      throw new SessionBranchError(`session "${id}" not found`, "SESSION_NOT_FOUND");
    }
    const meta = rowToMeta(row);

    let rawKeepLength: number;
    let kept: readonly SessionEvent[] | undefined;
    if (isLegacyVersion(row.fVersion)) {
      // 旧格式的持久化坐标与当前视图 seq 不一致：只有这条路径需要读日志（含格式转换与读视图修复）
      const log = await this.port.readLog(id, {}, signal);
      if (log === undefined) {
        throw new SessionBranchError(`session "${id}" not found`, "SESSION_NOT_FOUND");
      }
      const boundaryType = log.events[toBoundary]?.type;
      assertRewindBoundary(id, toBoundary, boundaryType, log.events.length - 1);
      rawKeepLength =
        toBoundary === -1 ? 0 : boundaryType === "turn/end" ? toBoundary + 1 : toBoundary;
      kept = balanceRewindPrefix(log.events.slice(0, rawKeepLength));
    } else {
      const boundaryType =
        toBoundary === -1 ? undefined : await this.port.eventTypeAt(id, toBoundary);
      assertRewindBoundary(id, toBoundary, boundaryType, row.fHeadSequence);
      rawKeepLength =
        toBoundary === -1 ? 0 : boundaryType === "turn/end" ? toBoundary + 1 : toBoundary;
    }
    const keepLength =
      kept === undefined ? await this.rewindKeepLength(id, rawKeepLength) : kept.length;
    if (keepLength < rawKeepLength) {
      this.live.warn?.(
        `session-rdb: rewind "${id}" dropped ${rawKeepLength - keepLength} trailing event(s) from seq ${keepLength} to keep the retained prefix's step pairs balanced`,
      );
    }

    const denseBoundary = keepLength - 1;
    const newSeedLength = await this.port.transaction(async (tx) => {
      signal?.throwIfAborted();
      const head = await tx.getHead(id);
      if (denseBoundary > head.fHeadSequence) {
        throw new SessionBranchError(
          `rewind boundary ${toBoundary} is beyond the stored head ${head.fHeadSequence}`,
          "INVALID_BOUNDARY",
        );
      }
      let nextHead: { fEventId: string; fSequence: number } | undefined;
      if (denseBoundary < head.fHeadSequence) {
        await tx.deleteBridgeTail(id, denseBoundary + 1);
        const prev = denseBoundary === -1 ? undefined : await tx.getPrevBridge(id, denseBoundary);
        nextHead =
          prev === undefined
            ? { fEventId: "", fSequence: -1 }
            : { fEventId: prev.fEventId, fSequence: prev.fSequence };
      }

      const storedSeedLength = await tx.getSeedLength(id);
      let shrunk = storedSeedLength;
      if (storedSeedLength !== null && storedSeedLength > denseBoundary + 1) {
        await tx.updateSeedLength(id, denseBoundary + 1);
        shrunk = denseBoundary + 1;
      }

      await tx.refreshTitle(id);
      // 撤回 / 重试是**现在**发生的活动：列表按「最近活动」（`f_last_event_at`）倒序，而重放出去的事件带的是
      // 它们原来的时间戳——只 bump revision 的话，被重试的会话会按创建时间沉到列表后面。
      const touchedAt = Date.now();
      if (nextHead === undefined) {
        await tx.bumpRevision(id, touchedAt);
      } else {
        // head 回退与 revision bump 是同一次行写：分成两条 UPDATE 就是两次行版本。
        await tx.updateHeadAndRevision(id, nextHead.fEventId, nextHead.fSequence, touchedAt);
      }
      return shrunk;
    });

    this.port.confirmHead(id, denseBoundary);

    if (live !== undefined) {
      // 内存 log 与存储同源的判据：上游 `Session.append` 用 `log.length` 当 seq，所以「内存条目数 - 1」
      // 就是存储 head。内存**落后**于存储时（导入 / 取消与截断的竞态），不能拿内存做长度运算——
      // `log.length = n` 会在尾部补出空洞，之后每次 append 的 seq 都与存储错位，撤回边界就会点到
      // 存储里不存在的位置。落后就按存储前缀**整体重建**；`replaceLiveSessionLog` 顺手把 folds /
      // derived / surface 这些派生缓存一并清掉。
      const liveLength = (live as unknown as { log: readonly SessionEvent[] }).log.length;
      let lastTurn: number;
      if (liveLength < keepLength) {
        const prefix =
          kept ??
          (await this.port.eventRows(id))
            .map(rowToEvent)
            .filter((event) => event.seq <= denseBoundary);
        replaceLiveSessionLog(live, prefix);
        lastTurn = prefix.findLast((event) => event.type === "turn/start")?.data.turn ?? 0;
      } else {
        lastTurn = truncateLiveSession(live, keepLength);
      }

      this.live.resetProjections?.(live);

      this.live.resetTokenMeter?.(live);
      const agent = this.live.getAgent(id);
      if (agent !== undefined) {
        agent.requestHeaderLogged = false;

        const phase = (agent as unknown as { phase?: { lastTurn?: number } }).phase;
        if (phase !== undefined) phase.lastTurn = lastTurn;
      }

      this.port.resetWriterAfterRewind(
        id,
        keepLength,
        newSeedLength === null ? undefined : newSeedLength,
      );

      agent?.inbox?.clear();

      // flush 是「把 live 缓冲尽力落库」：失败不该让撤回失败，也不该阻断下面的缓存刷新——
      // 撤回的正确性由库里的截断保证，缓存必须跟着新水位走，否则页面会一直显示撤回前的数据。
      try {
        await this.live.flush(live);
      } catch (error: unknown) {
        this.live.warn?.(
          `session-rdb: flush after rewind for "${id}" failed (the stored log is already truncated; live buffers may lag): ${describeError(error)}`,
        );
      }

      // 带上新水位：`write` 失败时缓存按这个水位截断兜底，而不是把撤回前的旧快照留在读路径上。
      await this.refreshProjectionCache({
        id: live.id,
        header: live.header,
        inheritedEventCount: live.inheritedEventCount,
        headSeq: keepLength - 1,
        // 检查点以**撤回后的内存 log** 为源：这是派生状态的重算，不是一次查询读——落库失败也要写回
        // （判据见 projection-cache.spec「flush 抛错时仍按内存 log 写回检查点」）。
        snapshotEvents: () => liveEventsOf(live),
      });
    } else {
      // rewind 不读日志：缓存行按新水位截断（保留下来的投影单元仍在截断前缀内）
      await this.refreshProjectionCache({
        id,
        header: meta,
        inheritedEventCount: SessionLogOffset(newSeedLength ?? row.fSeedLength ?? 0),
        headSeq: keepLength - 1,
        snapshotEvents: () => [],
      });
    }

    // 撤回不改统计：请求已发起就已经消耗过（见 ADR-撤回不回退统计）。
    return { header: rowToMeta(row), revision: (await this.port.readStoredRevision(id))! };
  }

  // 保留长度只依赖尾部窗口：从 rawKeepLength 往回读类型（有界），窗口没覆盖到最近一个 turn/end
  // 就翻倍重读，直到覆盖或到达前缀开头。
  private async rewindKeepLength(id: SessionId, rawKeepLength: number): Promise<number> {
    if (rawKeepLength === 0) return 0;
    let limit = 64;
    for (;;) {
      const rows = await this.port.eventTypesBefore(id, rawKeepLength, limit);
      const types = [...rows].reverse().map((row) => row.fType);
      const windowStart = rawKeepLength - types.length;
      if (types.includes("turn/end") || windowStart === 0 || types.length >= rawKeepLength) {
        return rewindKeepLength(types, rawKeepLength);
      }
      limit *= 4;
    }
  }

  private async refreshProjectionCache(session: ProjectionCacheSession): Promise<void> {
    if (this.live.refreshProjectionCache === undefined) return;
    try {
      await this.live.refreshProjectionCache(session);
    } catch {}
  }
}

// 分支行：把持久化后端的行级端口接到 `sessionBranch` 契约上，并负责 live 会话的内存 log 失效。
@Injectable()
export class SessionBranchRdb extends SessionBranch implements OnInit {
  private readonly persistence = inject(SessionPersistence);

  private readonly sessions = inject(SessionStore);

  private readonly agents = inject.optional(SessionAgentControl);

  private readonly logger = inject(Logger);

  // 可选能力（投影注册表 / token-meter / agent 目录）在**调用时**按名字读：装配里可能晚于本行挂载，
  // 装配期回填的那份引用不会随之更新。
  private row: Context | undefined;

  private readonly warned = new Set<string>();

  private provider: SessionBranchRdbProvider | undefined;

  onInit(ctx: Context): void {
    this.row = ctx;
    const store = asRdbStore(this.persistence);
    this.provider = new SessionBranchRdbProvider(store.branchPort(), {
      getSession: (id) => this.sessions.get(id),
      getAgent: (id) =>
        this.lookup<{ get(id: SessionId): LiveAgentLike | undefined }>("agents")?.get(id),
      flush: (session) => this.sessions.flush(session),
      warn: (message) => this.logger.warn(message),
      resetProjections: (session) => resetDerivedState(session, this.resetDeps()),
      resetTokenMeter: (session) => resetDerivedState(session, this.resetDeps()),
      refreshProjectionCache: async (session) => {
        // 投影缓存行可能晚于本行挂载（装配顺序按清单），所以在**调用时**按服务名读。
        const cache = this.lookup<ProjectionCacheLike>("sessionProjectionCache");
        if (cache === undefined) return;
        const cold = session.snapshotEvents().length === 0;
        if (cold && session.headSeq !== undefined && cache.truncateTo !== undefined) {
          try {
            await cache.truncateTo(session.header, session.inheritedEventCount, session.headSeq);
          } catch (error: unknown) {
            this.logger.warn(
              `session-rdb: projection cache truncate after rewind for "${session.id}" failed: ${describeError(error)}`,
            );
          }
          return;
        }
        try {
          await cache.write(session);
        } catch (error: unknown) {
          if (session.headSeq !== undefined && cache.truncateTo !== undefined) {
            try {
              await cache.truncateTo(session.header, session.inheritedEventCount, session.headSeq);
            } catch (fallbackError: unknown) {
              this.logger.warn(
                `session-rdb: projection cache truncate fallback after rewind for "${session.id}" failed: ${describeError(fallbackError)}`,
              );
            }
          }
          this.logger.warn(
            `session-rdb: projection cache rebuild after rewind for "${session.id}" failed (fell back to truncating the cache at the new head): ${describeError(error)}`,
          );
        }
      },
    });
  }

  // 覆盖导入等整段替换内存 log 的路径复用 rewind 的失效钩子（token-meter 水位是位置不是事件身份）。
  resetLiveDerivedState(session: Session): void {
    resetDerivedState(session, this.resetDeps());
  }

  readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: BranchAnchorMode,
    signal?: AbortSignal,
  ): Promise<BranchBoundary> {
    return this.providerOf().readBranchPrefix(id, atSeq, mode, signal);
  }

  readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
    return this.providerOf().readRawEvents(id, signal);
  }

  forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId> {
    return this.providerOf().forkFrom(sourceId, options, signal);
  }

  rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot> {
    return this.providerOf().rewind(id, toBoundary, signal);
  }

  private providerOf(): SessionBranchRdbProvider {
    if (this.provider === undefined) throw new Error("session-rdb: 分支行还没装配");
    return this.provider;
  }

  // 可选能力按名字在**调用时**读：晚挂载的服务也要看得到。
  private lookup<T>(name: string): T | undefined {
    return (this.row as unknown as { get(n: string, s?: boolean): unknown } | undefined)?.get(
      name,
      false,
    ) as T | undefined;
  }

  private resetDeps(): DerivedStateResetDeps {
    return {
      projections: () => this.lookup("sessionProjections"),
      tokenMeter: () => this.lookup("tokenMeter"),
      warnOnce: (key, message) => {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        this.logger.warn(message);
      },
    };
  }
}

interface ProjectionCacheLike {
  write(session: ProjectionCacheSession): Promise<void>;
  truncateTo?(
    header: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    headSeq: number,
  ): Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
