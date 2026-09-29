import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionStorageMetadata } from "@deepseek-ai/dsh-session-persistence";
import type { EventUsageRow } from "./log.ts";
import type { StorageRepository } from "./storage-takeover/types.ts";
import type { UsageActivityTotals, UsageAggregate, UsageTokenTotals } from "./usage.ts";

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

// 「会话行」列表项：管理面自己的列表（完整语料含归档 + 标题 + 最后活动时间）；为何与官方 `session/list`
// 分开见 ADR-会话列表两条路。
export interface SessionListRowRecord {
  sessionId: string;
  title: string | null;
  origin: string | null;
  cwd: string | null;
  createdAt: number;
  // 该会话最后一个事件的时间（没有事件时回落 `createdAt`）。
  updatedAt: number;
  archived: boolean;
  subagent: boolean;
  // 所属工作区标题；不属于任何工作区时为 null。
  workspace: string | null;
}

// 会话行列表的查询条件：搜索、子代理过滤与分页都在后端做（前端分页等于每次拉全量）。
export interface SessionListRowsQuery {
  // 匹配标题或所属工作区标题（大小写不敏感）；空串即不过滤。
  query?: string;
  // 是否连子代理派生会话一起返回（默认不含）。
  includeSubagents?: boolean;
  limit?: number;
  offset?: number;
}

export interface SessionListRowsPage {
  items: SessionListRowRecord[];
  // 过滤后的总数（分页前的），前端据此算页数。
  total: number;
}

// 活动计数的一个桶：本地日 + 四项计数（轮次 / 步骤 / 用户输入 / 工具调用）。
export interface SessionCountBucket extends UsageActivityTotals {
  day: string;
}

// 用量累加的一个桶：本地日 + 模型归属 + 五个 token 列。
export interface SessionUsageBucket extends UsageTokenTotals {
  day: string;
  provider: string | null;
  model: string | null;
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

  // 删除已无桥接行引用的事件行（孤儿），返回删除行数。
  collectOrphans(): Promise<number>;

  // 父会话已不存在（或没有父）的 subagent 会话：父被删后它们成了孤儿。
  listOrphanSubagentSessions(): Promise<SessionId[]>;

  // 用量统计的原始聚合：读三张派生统计表（`t_event_usage` + 两张会话汇总表），给出总量 / subagent 拆分、
  // 按天×模型的桶与按会话的行（事件行去重、排除孤儿）；`sinceMs` 起算（省略即全量），起点须对齐本地零点。
  usageReport(sinceMs?: number): Promise<UsageAggregate>;

  // 管理面的会话行列表：完整语料（含归档）+ 标题 + 最后活动时间，按活动倒序分页。
  listSessionRows(query?: SessionListRowsQuery): Promise<SessionListRowsPage>;

  // token 用量**旁路累加**（派生表 `t_session_usage`，不参与写事务、失败可丢——表可销毁重建）：每个
  // (会话, 本地日, 模型) 记一行；`buckets` 是本批要累加的 (day, provider, model, tokens)。
  incrementSessionUsage(id: SessionId, buckets: readonly SessionUsageBucket[]): Promise<void>;

  // 活动计数**旁路累加**（派生表 `t_session_counts`，同上）：每个 (会话, 本地日) 累加四项计数，
  // `buckets` 是本批要累加的 (day, turns, steps, userInputs, toolCalls)。
  incrementSessionCounts(id: SessionId, buckets: readonly SessionCountBucket[]): Promise<void>;

  // 按会话从事件表重算两张汇总表（旧日志重写之后调用：迁移进来的会话没有旁路累加的历史，得补算）。
  rebuildSessionStats(id: SessionId): Promise<void>;

  // 重算这些用量行的引用标记（`f_referenced` / `f_subagent`）：会话删除 / 日志重写之后调用，
  // `eventIds` 是被删掉的那批桥接行引用的事件（只有它们的引用可能消失）。
  // fork 与撤回（rewind）都**不**走这里——它们不改变已发生过的消耗（见 ADR-fork不继承统计、ADR-撤回不回退统计）。
  refreshEventUsageFlags(eventIds: readonly string[]): Promise<void>;

  // 删掉一个会话的汇总行（会话删除时；外键 CASCADE 之外再显式清一次）。
  deleteSessionStats(id: SessionId): Promise<void>;

  // 回收空间与统计（含 VACUUM）；不得在事务内执行。
  vacuum(): Promise<void>;

  close(): Promise<void>;
}
