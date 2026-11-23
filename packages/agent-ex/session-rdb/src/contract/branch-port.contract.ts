// 分支端口的形状：**最底层**（`contract/session-rdb-store.contract.ts` 要引用它，而 data 是它的下层）。
//
// 端口本身由数据面实现（`data/store/branch/port.ts` 的 `createBranchPort`），实现不在这里。
import type { SessionEvent, SessionHeader, SessionId } from "@morlay/dsh-session/contract";
import type {
  SessionHandle,
  SessionPersistenceRevision,
} from "@morlay/dsh-session-persistence/contract";
import type { SessionLogOffset } from "@morlay/dsh-session/contract";
import type { BackendTx, EventRow, SessionRow } from "./data-shapes.contract.ts";

/** 一份读出来的日志（分支只看这些字段）。 */
export interface BranchLog {
  meta: SessionHeader;
  inheritedEventCount: number;
  events: SessionEvent[];
  tornFrom?: number;
  incarnation: string;
  revision: number;
  storedCount: number;
  migrated: boolean;
}

/**
 * 分支能力需要的持久化面（端口）。
 *
 * 为什么不是整个 `SessionPersistenceRdb`：分支只需要「读日志前缀、写截断、认领复用映射」这几件事，
 * 端口里的每个动词都有真实调用方（不是把服务的方法表转抄一遍）。rewind 走直连快路径，
 * 所以这里保留了行级的 `eventRows` / `sessionRow` / `transaction`，而不是只给一个 `readLog`。
 */
export interface BranchPort {
  readonly ready: Promise<void>;

  readLog(
    id: SessionId,
    options?: { fromSeq?: number },
    signal?: AbortSignal,
  ): Promise<BranchLog | undefined>;

  create(
    meta: SessionHeader,
    options?: { inheritedEventCount?: SessionLogOffset },
  ): Promise<SessionHandle>;

  eventRows(id: SessionId, fromSequence?: number): Promise<EventRow[]>;

  eventTypesBefore(
    id: SessionId,
    beforeSequence: number,
    limit: number,
  ): Promise<Array<Pick<EventRow, "fSequence" | "fType">>>;

  sessionRow(id: SessionId): Promise<SessionRow | undefined>;

  eventTypeAt(id: SessionId, sequence: number): Promise<string | undefined>;

  transaction<T>(fn: (tx: BackendTx) => Promise<T>): Promise<T>;

  /** head 回退与 revision bump 是同一次行写，确认位点后写路径才允许继续 append。 */
  confirmHead(id: SessionId, sequence: number): void;

  /**
   * 截断前认领并断言写者位点。
   *
   * 没有它时 rewind 只看「边界有没有超过 head」：另一个实例在本实例 flush 之后提交的事件会被
   * 当作尾部静默删掉，双方都不报错。本实例还没读过这个会话时先认领当前 head（与迁移重写同一条口径），
   * 之后任何位点变化都会被拒绝。
   */
  guardHead(id: SessionId, storedHead: number): void;

  readStoredRevision(id: SessionId): Promise<SessionPersistenceRevision | undefined>;

  /** fork 复用父会话的事件行：子会话落写时按 seq 取回父行 id。 */
  registerReuseEventIds(childId: SessionId, map: ReadonlyMap<number, string>): void;

  dropReuseEventIds(childId: SessionId): void;

  /** rewind 截断后把活跃写句柄的游标与 seed 长度挪到新水位。 */
  resetWriterAfterRewind(id: SessionId, cursor: number, inheritedEventCount?: number): void;
}
