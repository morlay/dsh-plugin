// 行与读面的共享形状：**最底层**，除本目录外谁也不引。
//
// 为什么在这里：`data/backend.ts` 声明它们，`contract/session-rdb-store.contract.ts` 与
// `contract/branch-port.contract.ts` 引用它们；`data` 是 `contract` 的下层，形状落在 `data` 里就是
// 下层替上层定义类型，落回最底层才对。它们不是**端口**（`contract/index.ts` 只聚合端口），
// 所以不随包根导出——包出口形状不变。
import type { Condition, Operand } from "@morlay/zephyr-rdb";
import type { SessionId } from "@morlay/dsh-session/contract";
import type { SessionStorageMetadata } from "@morlay/dsh-session-persistence/contract";

// 会话行（物化列；列名与 `data/entities/v3/sessions.ts` 一一对应）。
export interface SessionRow {
  fSessionId: string;

  fHeadEventId: string;
  fHeadSequence: number;
  fVersion: number;
  fCreatedAt: number;
  fCwd: string | null;
  fParentSession: string | null;
  fSeedLength: number | null;
  fOrigin: string | null;
  fDelegationDepth: number | null;
  fAgentPreset: string | null;

  fIncarnation: string;

  fRevision: number;

  fArchivedAt: number | null;

  fPinnedSeq: number | null;

  fLastEventAt: number | null;
}

// 事件行（插入面：写路径一次折好再落库）。
export interface EventInsert {
  fEventId: string;
  fParentId: string;
  fType: string;
  fKind: string;
  fRole: string;
  fName: string;
  fActionId: string;
  fEncoding: string;
  fData: string;
  fCreatedAt: number;
}

// 事件行（读面：带上桥接行的 surface 操作）。
export interface EventRow {
  fEventId: string;

  fSequence: number;

  fType: string;

  fKind: string;

  fRole: string;

  fName: string;

  fActionId: string;

  fCreatedAt: number;

  fData: string;

  fSurfaceOp: string | null;
}

// 一条事件行的用量（`t_event_usage` 的行形状）。写路径折好、读侧维度已物化在行上。
export interface EventUsageRow {
  fEventId: string;
  fCreatedAt: number;
  fDay: string;
  fProvider: string | null;
  fModel: string | null;
  fReferenced: number;
  fSubagent: number;
  fInputTokens: number;
  fOutputTokens: number;
  fCacheReadTokens: number;
  fReasoningTokens: number;
  fTotalTokens: number;
}

/** 写事务面：写路径与分支只在事务里动行。 */
export interface BackendTx {
  upsertSession(storage: SessionStorageMetadata, incarnation: string): Promise<void>;

  getHead(id: SessionId): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">>;

  getSeedLength(id: SessionId): Promise<number | null>;

  updateSeedLength(id: SessionId, seedLength: number): Promise<void>;

  refreshTitle(id: SessionId): Promise<void>;

  // 插入事件行与它们的用量行（`usageRows` 由写路径一次折好，读侧维度已物化在行上）。
  // 这一批事件与桥接行同事务，提交即「被引用」。
  insertEvents(events: EventInsert[], usageRows: readonly EventUsageRow[]): Promise<void>;

  insertBridges(
    rows: Array<{
      fSessionId: SessionId;
      fEventId: string;
      fSequence: number;
      fSurfaceOp: string | null;
    }>,
  ): Promise<void>;

  updateHead(id: SessionId, headEventId: string, headSequence: number): Promise<void>;

  /** 推进 head 并 bump revision：同一行一次 UPDATE（分两次写是纯写放大）。 */
  updateHeadAndRevision(
    id: SessionId,
    headEventId: string,
    headSequence: number,
    lastEventAt?: number,
  ): Promise<void>;

  // 写批次提交时递增 revision；给了 `lastEventAt` 就一并把「最后活动时间」往前推（只增不减）。
  bumpRevision(id: SessionId, lastEventAt?: number): Promise<void>;

  // 删掉 fromSequence 起的桥接行，返回被删行引用的 event id（调用方据此重算这些用量行的引用标记）。
  deleteBridgeTail(id: SessionId, fromSequence: number): Promise<readonly string[]>;

  getPrevBridge(
    id: SessionId,
    sequence: number,
  ): Promise<{ fEventId: string; fSequence: number } | undefined>;

  // 删除整条会话；返回被删桥接行引用的 event id（引用标记要跟着重算）。
  deleteSession(id: SessionId): Promise<readonly string[]>;

  // 批量删除整条会话：桥接行、workspace 归属行、投影行与会话行；返回删除行数与被删桥接行引用的 event id。
  deleteSessions(ids: SessionId[]): Promise<{ deleted: number; eventIds: readonly string[] }>;
}

// 会话表上的列引用（筛选下推用：条件由调用方拼，表句柄留在读面里）。
export interface SessionFilterColumns {
  readonly id: Operand;
  readonly cwd: Operand;
  readonly createdAt: Operand;
  readonly parent: Operand;
}

// 事件表上的列引用。
export interface EventFilterColumns {
  readonly seq: Operand;
  readonly time: Operand;
  readonly type: Operand;
}

/** 会话读的共享实现：写路径之外的所有查询都在这里（两方言共用一套投影查询）。 */
export interface ReadModel {
  getSession(id: string): Promise<SessionRow | undefined>;
  getEventRows(id: string, fromSequence?: number): Promise<EventRow[]>;
  getEventTypeAt(id: string, sequence: number): Promise<string | undefined>;
  getEventTypesBefore(
    id: string,
    beforeSequence: number,
    limit: number,
  ): Promise<Array<Pick<EventRow, "fSequence" | "fType">>>;
  listSessions(): Promise<SessionRow[]>;

  // 筛选下推要的列引用：条件由调用方拼，表句柄留在这里（唯一一处取表）。
  readonly columns: {
    readonly session: SessionFilterColumns;
    readonly event: EventFilterColumns;
  };

  // 带条件的会话行查询：筛选条件进 WHERE，只取需要的行（listSessions 是全量）。
  selectSessionRows(condition?: Condition): Promise<SessionRow[]>;

  // 带条件的事件行查询：sessionId + WHERE，只取命中行。
  selectEventRows(id: string, condition?: Condition): Promise<EventRow[]>;

  // 只要事件坐标与 surface 操作（不取 f_data）：listEvents 用它避免整段日志 JSON 进内存。
  selectEventMetas(
    id: string,
  ): Promise<Array<{ seq: number; type: string; time: number; surfaceOp: string | null }>>;

  // 这个会话里有没有 replace 型的 surface 操作：有才需要折叠求 surface，没有就是"append 即 current"。
  hasSurfaceReplace(id: string): Promise<boolean>;
  /** 父会话已不在表里的 subagent 会话。 */
  listOrphanSubagentSessions(): Promise<string[]>;
}

// 会话行列表的过滤条件（与端点请求一一对应；列在 `admin`/`data` 侧拼）。
export type SessionRowsOriginFilter = "human" | "subagent";

// 归档状态过滤：只看归档 / 只看未归档；不给就是全部。
export type SessionRowsArchivedFilter = "only" | "unarchived";

export interface SessionRowsFilterArgs {
  readonly query?: string | undefined;
  // 旧口径：是否连子代理一起返回（默认不含）；与 origin 同时给时 origin 优先。
  readonly includeSubagents?: boolean | undefined;
  readonly origin?: SessionRowsOriginFilter | undefined;
  readonly archived?: SessionRowsArchivedFilter | undefined;
  // 最近活动时间的半开区间（与列表的 updatedAt 同列：f_last_event_at，回落 f_created_at）。
  readonly updatedAfter?: number | undefined;
  readonly updatedBefore?: number | undefined;
}
