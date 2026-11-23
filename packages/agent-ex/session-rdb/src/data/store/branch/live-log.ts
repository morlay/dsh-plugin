// live 会话的内存 log 编辑面：快照、截断、整段替换（连带清掉 folds / derived / surface 缓存）。
//
// 这些是**内存里那份日志**的操作，不是存储侧；rewind / fork / 覆盖导入共用它们。
import type { Session, SessionEvent } from "@morlay/dsh-session/contract";

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
