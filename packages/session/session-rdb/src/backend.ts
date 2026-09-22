import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionStorageMetadata } from "@deepseek-ai/dsh-session-persistence";
import type { StorageRepository } from "./storage-takeover/types.ts";
import type { UsageAggregate } from "./usage.ts";

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

export interface BackendTx {
  upsertSession(storage: SessionStorageMetadata, incarnation: string): Promise<void>;

  getHead(id: SessionId): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">>;

  getSeedLength(id: SessionId): Promise<number | null>;

  updateSeedLength(id: SessionId, seedLength: number): Promise<void>;

  refreshTitle(id: SessionId): Promise<void>;

  insertEvents(events: EventInsert[]): Promise<void>;

  insertBridges(
    rows: Array<{
      fSessionId: SessionId;
      fEventId: string;
      fSequence: number;
      fSurfaceOp: string | null;
    }>,
  ): Promise<void>;

  updateHead(id: SessionId, headEventId: string, headSequence: number): Promise<void>;

  /** 写批次提交时递增 revision；给了 `lastEventAt` 就一并把「最后活动时间」往前推（只增不减）。 */
  bumpRevision(id: SessionId, lastEventAt?: number): Promise<void>;

  deleteBridgeTail(id: SessionId, fromSequence: number): Promise<void>;

  getPrevBridge(
    id: SessionId,
    sequence: number,
  ): Promise<{ fEventId: string; fSequence: number } | undefined>;

  deleteSession(id: SessionId): Promise<void>;

  /** 批量删除整条会话：桥接行、workspace 归属行、投影行与会话行。 */
  deleteSessions(ids: SessionId[]): Promise<number>;
}

/**
 * 「会话行」列表项：管理面自己的列表用（完整语料，含归档）+ 标题 + 最后活动时间。
 *
 * 与官方列表（`session/list` → `ctx.sessionQuery.listSessions`）的区别：那条按部署策略**默认排除归档**，
 * 这里给的是完整集合，标题也直接带出来（官方那条的标题走投影缓存）。
 */
export interface SessionListRowRecord {
  sessionId: string;
  title: string | null;
  origin: string | null;
  cwd: string | null;
  createdAt: number;
  /** 该会话最后一个事件的时间（没有事件时回落 `createdAt`）。 */
  updatedAt: number;
  archived: boolean;
  subagent: boolean;
  /** 所属工作区标题；不属于任何工作区时为 null。 */
  workspace: string | null;
}

/** 会话行列表的查询条件：搜索、子代理过滤与分页都在后端做（前端分页等于每次拉全量）。 */
export interface SessionListRowsQuery {
  /** 匹配标题或所属工作区标题（大小写不敏感）；空串即不过滤。 */
  query?: string;
  /** 是否连子代理派生会话一起返回（默认不含）。 */
  includeSubagents?: boolean;
  limit?: number;
  offset?: number;
}

export interface SessionListRowsPage {
  items: SessionListRowRecord[];
  /** 过滤后的总数（分页前的），前端据此算页数。 */
  total: number;
}

/** 活动计数的一个桶：本地日 + 事件类型 + 计数。 */
export interface EventCountBucket {
  day: string;
  type: string;
  count: number;
}

export interface Backend {
  readonly kind: "sqlite" | "postgres";

  readonly storeIdentity: string;

  readonly storage: StorageRepository;

  open(): Promise<void>;

  getSession(id: SessionId): Promise<SessionRow | undefined>;

  getEventRows(id: SessionId, fromSequence?: number): Promise<EventRow[]>;

  getEventTypeAt(id: SessionId, sequence: number): Promise<string | undefined>;

  getEventTypesBefore(
    id: SessionId,
    beforeSequence: number,
    limit: number,
  ): Promise<Array<Pick<EventRow, "fSequence" | "fType">>>;

  listSessions(): Promise<SessionRow[]>;

  transaction<T>(fn: (tx: BackendTx) => Promise<T>): Promise<T>;

  /** 删除已无桥接行引用的事件行（孤儿），返回删除行数。 */
  collectOrphans(): Promise<number>;

  /** 父会话已不存在（或没有父）的 subagent 会话：父被删后它们成了孤儿。 */
  listOrphanSubagentSessions(): Promise<SessionId[]>;

  /**
   * 用量统计的原始聚合：token 用量读 `t_event_usage`、活动计数读派生表 `t_event_counts`，
   * 加按天×模型的桶与按会话的行（事件行去重、排除孤儿）。
   * @param sinceMs - 只算该时刻（含）之后的事件行；省略即全量。
   */
  usageReport(sinceMs?: number): Promise<UsageAggregate>;

  /** 管理面的会话行列表：完整语料（含归档）+ 标题 + 最后活动时间，按活动倒序分页。 */
  listSessionRows(query?: SessionListRowsQuery): Promise<SessionListRowsPage>;

  /**
   * 活动计数**旁路累加**（派生表 `t_event_counts`，不参与写事务、失败可丢——表可销毁重建）：
   * 每个 (会话, 本地日, 事件类型) 记一行计数。
   * @param id - 会话 id。
   * @param buckets - 本批要累加的 (day, type, count)。
   */
  incrementEventCounts(id: SessionId, buckets: readonly EventCountBucket[]): Promise<void>;

  /**
   * 按会话从事件表重算活动计数（rewind / fork 之后调用）：先删该会话的行再重算。
   * @param id - 会话 id。
   */
  rebuildEventCounts(id: SessionId): Promise<void>;

  /** 删掉一个会话的活动计数行（会话删除时）。 */
  deleteEventCounts(id: SessionId): Promise<void>;

  /** 回收空间与统计（含 VACUUM）；不得在事务内执行。 */
  vacuum(): Promise<void>;

  close(): Promise<void>;
}
