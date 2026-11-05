// RDB 后端的**能力面**：`sessionPersistence` 契约之外的那几件（分支端口、管理面动作、行级读）。
//
// 为什么不是一个独立令牌：一个实例只能占一个令牌，而 `sessionPersistence` 那个令牌已被上游契约固定。
// 所以这一面在契约上声明成普通接口，由 `sessionPersistence` 的实现提供，消费方在边界处探测一次。
import type { SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import type { Condition } from "@morlay/zephyr-rdb";
import type { BranchPort } from "../rdb/branch/port.ts";
import type { EventRow, ReadModel, SessionRow } from "../rdb/backend.ts";
import type { EventFilterColumns, SessionFilterColumns } from "../rdb/query-filters.ts";
import type { SessionRowsItem } from "../endpoint/session-admin-endpoint.ts";

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

// 行级查询的一页。
export interface SessionRowsPage {
  readonly items: SessionRowsItem[];
  readonly total: number;
}

export interface SessionRdbStore {
  // 后端就绪（分支端口与 live 路由都先等它）。
  readonly ready: Promise<void>;

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
  listRows(query: {
    query?: string;
    includeSubagents?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<SessionRowsPage>;

  // 只允许删除已归档且不在运行中的会话。
  deleteSession(id: string, signal?: AbortSignal): Promise<void>;

  // 整段导入（zip 里的 JSONL 或已有会话的整体替换）。
  importZip(zip: Uint8Array, targetId?: string): Promise<string>;

  // 回收孤儿会话与事件行，重算派生统计，再 VACUUM。
  organize(): Promise<SessionOrganizeReport>;

  // 用量统计的一次聚合。
  usageReport(sinceMs?: number): Promise<SessionUsageAggregate>;

  // 已归档的会话 id 集。
  archivedSessionIds(): Promise<ReadonlySet<string>>;

  // storage 接管要的库句柄：与后台是**同一个库**（KV 域与会话表同库，事务才能跨着用）。
  // 后端打开之后才有值，所以是异步口。
  storageRepository(): Promise<import("../rdb/storage-takeover/types.ts").StorageRepository>;

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
