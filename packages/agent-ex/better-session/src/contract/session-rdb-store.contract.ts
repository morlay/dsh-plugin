// RDB 后端的**能力面**：`sessionPersistence` 契约之外的那几件（分支端口、管理面动作、行级读）。
//
// 为什么不是一个独立令牌：一个实例只能占一个令牌，而 `sessionPersistence` 那个令牌已被上游契约固定。
// 所以这一面在契约上声明成普通接口，由 `sessionPersistence` 的实现提供，消费方在边界处探测一次。
import type { SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import type { Condition } from "@morlay/zephyr-rdb";
import type { BatchItemResult } from "./batch-result.contract.ts";
import type { BranchPort } from "./branch-port.contract.ts";
import type { EventRow, ReadModel, SessionRow } from "./data-shapes.contract.ts";
import type { EventFilterColumns, SessionFilterColumns } from "./data-shapes.contract.ts";
import type {
  SessionLocateRequest,
  SessionLocateValue,
  SessionRepairAction,
  SessionRepairValue,
  SessionRowsItem,
  SessionRowsSearchStage,
} from "../endpoint/session-admin-endpoint.ts";
import type { ConsistencyReport } from "./consistency.contract.ts";
import type { SessionRowsFilterArgs } from "./data-shapes.contract.ts";

// 整理数据的三项计数。
export interface SessionOrganizeReport {
  readonly orphanSessions: number;
  readonly orphanEvents: number;
  readonly rebuiltSessions: number;
}

// 一次用量聚合的原始结果（按天 × 模型分桶 + 按会话行）。
export interface SessionUsageAggregate {
  readonly totals: Record<string, number>;
  readonly subagent: Record<string, number>;
  readonly human: Record<string, number>;
  readonly buckets: readonly Record<string, unknown>[];
  readonly sessions: readonly Record<string, unknown>[];
}

// 会话行列表的查询条件：搜索、结构化过滤与分页（与端点请求一一对应）。
export interface SessionRowsQuery extends SessionRowsFilterArgs {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

// 行级查询的一页：实际走的搜索段一并交回（页面据此标注两段式）。
export interface SessionRowsPage {
  readonly items: SessionRowsItem[];
  readonly total: number;
  readonly searchStage?: SessionRowsSearchStage;
}

// 批量删除的一条结果：失败的项带域码，成功的项不带。三条批量动作共用 `BatchItemResult`。
export type SessionBulkDeleteItem = BatchItemResult;

// 批量删除的整批结果：逐条结算，不因一条失败回滚整批。
export interface SessionBulkDeleteResult {
  readonly items: readonly SessionBulkDeleteItem[];
}

// 批量导出的一条：成功给上游 format 的日志文件名与 JSONL 正文，失败带域码（不存在的会话给 SESSION_NOT_FOUND）。
export interface SessionExportItem extends BatchItemResult {
  // 上游 session format 的 artifact 名（`session.vN.jsonl`）：一份 zip 里就放它，不另立 manifest。
  readonly filename?: string | undefined;
  // 整段日志的 JSONL 正文（上游 format：header 行 + 事件行）。
  readonly content?: string | undefined;
}

// 批量导出的整批结果：逐条，一条失败不影响其它条。
export interface SessionExportBatchResult {
  readonly items: readonly SessionExportItem[];
}

// 批量导入的一条：成功给新铸的会话 id 与包里的 artifact 名，失败带域码。
export interface SessionImportBatchItem extends Omit<BatchItemResult, "sessionId"> {
  // 失败条**没有建成**，所以没有会话 id（不是空串）。
  readonly sessionId?: string | undefined;
  // zip 里那份 artifact 的文件名（`parseSessionFormatLogFilename` 认出来的）；认不出来时缺省。
  readonly filename?: string | undefined;
}

// 批量导入的整批结果：逐条，一条坏包不影响其它包。
export interface SessionImportBatchResult {
  readonly items: readonly SessionImportBatchItem[];
}

// 跨工作区复制的结果：新派生的子会话与它挂上的工作区（源会话原样保留）。
export interface SessionCopyWorkspaceResult {
  readonly sessionId: string;
  readonly workspaceId: string;
}

// 事件定位的条件：与端点请求一一对应（会话身份由调用参数给）。
export type SessionEventLocatorQuery = Omit<SessionLocateRequest, "sessionId">;

export interface SessionRdbStore {
  // 后端就绪（分支端口与 live 路由都先等它）。
  readonly ready: Promise<void>;

  // 一致性检查：派生统计表与事件行对不对得上（只读、只报告；修不修由调用方决定）。
  checkConsistency(): Promise<ConsistencyReport>;

  // 分支能力要的行级端口。
  branchPort(): BranchPort;

  // 读面：会话行 / 事件行的条件查询（筛选下推到 SQL 用的就是它）。
  readModel(): ReadModel;

  // 会话行 → header 与继承前缀长度：**不读日志**（`load` 会把整段事件拉回来）。
  headerOf(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ header: SessionHeader; inheritedEventCount: number } | undefined>;

  // 筛选下推：列引用 + 条件查询。调用方拿列拼条件，条件进 WHERE。
  sessionFilterColumns(): SessionFilterColumns;

  eventFilterColumns(): EventFilterColumns;

  selectSessionRows(condition?: Condition): Promise<SessionRow[]>;

  selectEventRows(id: string, condition?: Condition): Promise<EventRow[]>;

  // 读整段日志（含格式转换与读视图修复）。
  readRawEvents(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>;

  // 一次完整读（含继承前缀的账目）：`load` 的语义是「读一次完整快照」，不经 handle 面再读一遍。
  load(
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    meta: SessionHeader;
    inheritedEventCount: number;
    events: readonly SessionEvent[];
  }>;

  // 从某个 seq 起读（分支与管理面只用尾部窗口）。
  readFrom(
    id: string,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{
    meta: SessionHeader;
    inheritedEventCount: number;
    events: readonly SessionEvent[];
  }>;

  // 一次 append（开写句柄、追加、关句柄）。
  append(id: string, events: readonly SessionEvent[]): Promise<void>;

  // 建会话并追加一批（导入通道用）。
  createAndAppend(
    header: SessionHeader,
    events: readonly SessionEvent[],
    inheritedEventCount?: number,
  ): Promise<void>;

  // 整段日志的导出件（文件名 + JSONL 文本）。
  readRaw(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ inheritedEventCount: number; filename: string; content: string } | undefined>;

  // 管理面的会话行列表：完整语料（含归档）+ 标题 + 最后活动时间。
  listRows(query?: SessionRowsQuery): Promise<SessionRowsPage>;

  // 只允许删除已归档且不在运行中的会话。
  deleteSession(id: string, signal?: AbortSignal): Promise<void>;

  // 事件定位：条件（文本 LIKE / 类型 / 角色 / 名字 / 时间 / seq 窗口）下推到 SQL，只回命中片段与窗口。
  locateEvents(sessionId: string, query?: SessionEventLocatorQuery): Promise<SessionLocateValue>;

  // 坏会话的三个修法：逐会话、不动别的会话；修法语义见各实现。
  repairSession(sessionId: string, action: SessionRepairAction): Promise<SessionRepairValue>;

  // 批量删除：逐条复用单条的守卫，返回逐条结果；整批不回滚。
  bulkDelete(ids: readonly string[]): Promise<SessionBulkDeleteResult>;

  // 整段导入（zip 里的 JSONL 或已有会话的整体替换）。
  importZip(zip: Uint8Array, targetId?: string): Promise<string>;

  // 批量导出：逐条复用单条导出（同一份上游 format），逐条结算。
  exportMany(ids: readonly string[]): Promise<SessionExportBatchResult>;

  // 批量导入：逐条把 zip 落成新会话，逐条结算（坏包不影响其它包）。
  importMany(zips: readonly Uint8Array[]): Promise<SessionImportBatchResult>;

  // 跨工作区复制：fork（子会话的 cwd 换成目标工作区的路径）再交给 workspace 域 attach；不新增移动动作。
  copyToWorkspace(sessionId: string, workspaceId: string): Promise<SessionCopyWorkspaceResult>;

  // 回收孤儿会话与事件行，重算派生统计，再 VACUUM。
  organize(): Promise<SessionOrganizeReport>;

  // 用量统计的一次聚合。
  usageReport(sinceMs?: number): Promise<SessionUsageAggregate>;

  // 已归档的会话 id 集。
  archivedSessionIds(): Promise<ReadonlySet<string>>;

  // storage 接管要的库句柄：与后台是**同一个库**（KV 域与会话表同库，事务才能跨着用）。
  // 后端打开之后才有值，所以是异步口。
  storageRepository(): Promise<import("../storage/types.ts").StorageRepository>;

  // 卸载时关掉后端。
  close(): Promise<void>;

  // live 会话内存 log 的失效钩子（导入 / 撤回后复用）。
  resetLiveDerivedState(session: unknown): void;
}

// 能力探测：`sessionPersistence` 的实现不是 RDB 后端时给出**指名**的失败，而不是让调用方读到 `undefined`。
export function asRdbStore(persistence: unknown): SessionRdbStore {
  const candidate = persistence as Partial<SessionRdbStore> | undefined;
  if (candidate === undefined || typeof candidate.branchPort !== "function") {
    throw new Error(
      "本装配的 sessionPersistence 不是 RDB 后端：分支与编辑编排需要 @morlay/better-session 的存储实现",
    );
  }
  return candidate as SessionRdbStore;
}
