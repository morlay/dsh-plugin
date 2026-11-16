// `sessionAdmin` 这一组的跨端契约：会话管理页（列表 / 删除 / 导入 / 导出 / 整理 / 用量）。
//
// 源包的五条 HTTP 路由（`/api/morlay/v1/session/{rows,delete,import,export,organize,usage}`）在这里
// 收成一组 remote 方法：路径定动作的那层由方法名承担，错误码走 `RemoteResultWire` 的 `error.code`。
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/client/remote";
import type { BatchItemResult } from "../contract/batch-result.contract.ts";

// 一条会话行：完整语料（含归档）+ 标题 + 最后活动时间。
export interface SessionRowsItem {
  readonly sessionId: string;
  readonly title: string | null;
  readonly origin: string | null;
  readonly cwd: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived: boolean;
  readonly workspace: string | null;
}

export interface SessionRowsRequest {
  readonly query?: string;
  readonly includeSubagents?: boolean;
  // 结构化过滤：最近活动时间（与列表的 updatedAt 同列）、来源、归档状态。
  readonly updatedAfter?: number;
  readonly updatedBefore?: number;
  readonly origin?: "human" | "subagent";
  readonly archived?: "only" | "unarchived";
  readonly page?: number;
  readonly pageSize?: number;
}

// 两段式搜索**实际走的段**：前缀（范围比较）/ 全文（LIKE %x%）/ 没走（没有搜索词，只过滤不搜）。
//
// 家的理由：它是 wire 上的字段（`rows` 的返回值），两端与进程内端口都要用同一份——
// 以前端点、契约、行查询、宿主列表各抄一份联合类型，改一处就漂。
export type SessionRowsSearchStage = "prefix" | "contains" | "none";

export interface SessionRowsValue {
  readonly items: readonly SessionRowsItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  // 实际走的搜索段（prefix / contains / none）：前缀没命中才退全文。
  readonly searchStage?: SessionRowsSearchStage;
}

export interface SessionDeleteRequest {
  readonly sessionId: string;
}

export interface SessionDeleteValue {
  readonly deleted: string;
}

// 批量删除的请求与逐条结果：失败项带域码，整批不回滚。
export interface SessionBulkDeleteRequest {
  readonly sessionIds: readonly string[];
}

// 批量删除的一条：`sessionId` / `ok` / `code?` 是三条批量动作的共同形状（`BatchItemResult`）。
export type SessionBulkDeleteItem = BatchItemResult;

export interface SessionBulkDeleteValue {
  readonly items: readonly SessionBulkDeleteItem[];
}

// 导入的载荷是 zip 的 base64：remote 只走 JSON，二进制要自己编码。
export interface SessionImportRequest {
  readonly zip: string;
  readonly sessionId?: string;
}

export interface SessionImportValue {
  readonly sessionId: string;
}

export interface SessionExportRequest {
  readonly sessionId: string;
}

export interface SessionExportValue {
  readonly filename: string;
  readonly zip: string;
}

// 批量导出的请求与逐条结果：每条一份 zip（里面是上游 format 的 JSONL），失败条带域码。
export interface SessionExportManyRequest {
  readonly sessionIds: readonly string[];
}

export interface SessionExportManyItem extends BatchItemResult {
  // 下载用的文件名（`<sessionId>.zip`）；失败条没有。
  readonly filename?: string | undefined;
  // 单文件 zip 的 base64（remote 只走 JSON）。
  readonly zip?: string | undefined;
}

export interface SessionExportManyValue {
  readonly items: readonly SessionExportManyItem[];
}

// 批量导入的请求与逐条结果：包是 zip 的 base64，失败条带域码（坏包不影响其它包）。
export interface SessionImportManyRequest {
  readonly zips: readonly string[];
}

export interface SessionImportManyItem extends Omit<BatchItemResult, "sessionId"> {
  // 新建的会话 id；失败条**没有建成**，所以这里是可选（不是空串——空串会把"没有身份"伪装成身份）。
  readonly sessionId?: string | undefined;
  // 包里那份 artifact 的文件名（上游 format 口径）；认不出来时缺省。
  readonly filename?: string | undefined;
}

export interface SessionImportManyValue {
  readonly items: readonly SessionImportManyItem[];
}

// 跨工作区复制：在目标工作区里派生一个新会话（源会话保留）。
export interface SessionCopyWorkspaceRequest {
  readonly sessionId: string;
  readonly workspaceId: string;
}

export interface SessionCopyWorkspaceValue {
  // 新派生的子会话。
  readonly sessionId: string;
  readonly workspaceId: string;
}

export interface SessionOrganizeValue {
  readonly stoppedAgents: number;
  readonly orphanSessions: number;
  readonly orphanEvents: number;
  readonly rebuiltSessions: number;
  readonly vacuumed: boolean;
}

// 事件定位的查询：文本走 LIKE（大小写不敏感），其余是列上的等值 / 区间；seq 窗口是闭区间 [fromSeq, toSeq]。
export interface SessionLocateRequest {
  readonly sessionId: string;
  // 命中文本：事件行原文 LIKE %text%（大小写不敏感）。
  readonly text?: string;
  readonly types?: readonly string[];
  readonly role?: string;
  readonly name?: string;
  // 事件时间的闭区间。
  readonly fromTime?: number;
  readonly toTime?: number;
  // seq 窗口的闭区间；省略即整段日志。越界与两端颠倒都是显式失败（SESSION_QUERY_INVALID_WINDOW）。
  readonly fromSeq?: number;
  readonly toSeq?: number;
  readonly limit?: number;
}

// 一条命中：定位只回序号与命中片段，不搬整段事件体。
export interface SessionLocateItem {
  readonly seq: number;
  readonly type: string;
  // 事件行上的角色 / 名字列（没有时是 null）。
  readonly role: string | null;
  readonly name: string | null;
  readonly time: number;
  // 命中片段：优先取事件语义文本，读不出来时退回到事件行原文。
  readonly snippet: string;
}

export interface SessionLocateValue {
  readonly sessionId: string;
  readonly items: readonly SessionLocateItem[];
  // 命中的总条数（不受 limit 影响）。
  readonly total: number;
  // 这次查询生效的 seq 窗口。
  readonly window: { readonly fromSeq: number; readonly toSeq: number };
}

// 坏会话的三个修法：丢坏尾部（只保留最后一个可读边界之前）/ 整段重写 / 删除（走现有删除守卫）。
export type SessionRepairAction = "drop-tail" | "rewrite" | "delete";

export interface SessionRepairRequest {
  readonly sessionId: string;
  readonly action: SessionRepairAction;
}

export interface SessionRepairValue {
  readonly sessionId: string;
  readonly action: SessionRepairAction;
  // 修完仍在日志里的事件条数 / 被丢弃的事件条数（删除修法丢掉整条会话）。
  readonly keptEvents: number;
  readonly droppedEvents: number;
}

// 体检的一条不一致：kind 是检查项，subject 是会话 id 或事件 id，detail 给期望与实际的差。
export interface SessionConsistencyIssue {
  readonly kind: string;
  readonly subject: string;
  readonly detail: string;
}

// 体检报告：只报不修；修法走 repair。
export interface SessionConsistencyValue {
  readonly ok: boolean;
  readonly checked: {
    readonly sessions: number;
    readonly events: number;
    readonly bridges: number;
    readonly usageRows: number;
    readonly countRows: number;
  };
  readonly issues: readonly SessionConsistencyIssue[];
}

// 时间范围的语义键：`all` 不限；`day` / `week` 是本地自然日 / 自然周；`7d` / `30d` / `90d` 是最近 N 个自然日。
export type SessionUsageRange = "all" | "day" | "week" | "7d" | "30d" | "90d";

export interface SessionUsageRequest {
  readonly range?: SessionUsageRange;
}

export interface SessionUsageTokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

export interface SessionUsageActivityTotals {
  readonly turns: number;
  readonly steps: number;
  readonly userInputs: number;
  readonly toolCalls: number;
}

export interface SessionUsageTotals extends SessionUsageTokenTotals, SessionUsageActivityTotals {}

export interface SessionUsageBucket extends SessionUsageTokenTotals {
  readonly day: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly subagent: boolean;
}

export interface SessionUsageSessionRow extends SessionUsageTotals {
  readonly sessionId: string;
  readonly title: string | null;
  readonly subagent: boolean;
  readonly archived: boolean;
}

export interface SessionUsageValue {
  readonly totals: SessionUsageTotals;
  readonly subagent: SessionUsageTotals;
  readonly human: SessionUsageTotals;
  readonly buckets: readonly SessionUsageBucket[];
  readonly sessions: readonly SessionUsageSessionRow[];
}

@RemoteGroup({ name: "sessionAdmin" })
export class SessionAdminEndpoint {
  @RemoteMethod()
  async rows(_request: SessionRowsRequest): Promise<RemoteResultWire<SessionRowsValue>> {
    throw new Error("sessionAdmin/rows：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async delete(_request: SessionDeleteRequest): Promise<RemoteResultWire<SessionDeleteValue>> {
    throw new Error("sessionAdmin/delete：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async bulkDelete(
    _request: SessionBulkDeleteRequest,
  ): Promise<RemoteResultWire<SessionBulkDeleteValue>> {
    throw new Error("sessionAdmin/bulkDelete：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async import(_request: SessionImportRequest): Promise<RemoteResultWire<SessionImportValue>> {
    throw new Error("sessionAdmin/import：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async export(_request: SessionExportRequest): Promise<RemoteResultWire<SessionExportValue>> {
    throw new Error("sessionAdmin/export：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async copyToWorkspace(
    _request: SessionCopyWorkspaceRequest,
  ): Promise<RemoteResultWire<SessionCopyWorkspaceValue>> {
    throw new Error("sessionAdmin/copyToWorkspace：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async exportMany(
    _request: SessionExportManyRequest,
  ): Promise<RemoteResultWire<SessionExportManyValue>> {
    throw new Error("sessionAdmin/exportMany：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async importMany(
    _request: SessionImportManyRequest,
  ): Promise<RemoteResultWire<SessionImportManyValue>> {
    throw new Error("sessionAdmin/importMany：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async organize(): Promise<RemoteResultWire<SessionOrganizeValue>> {
    throw new Error("sessionAdmin/organize：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async usage(_request: SessionUsageRequest): Promise<RemoteResultWire<SessionUsageValue>> {
    throw new Error("sessionAdmin/usage：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async locate(_request: SessionLocateRequest): Promise<RemoteResultWire<SessionLocateValue>> {
    throw new Error("sessionAdmin/locate：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async repair(_request: SessionRepairRequest): Promise<RemoteResultWire<SessionRepairValue>> {
    throw new Error("sessionAdmin/repair：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async consistency(): Promise<RemoteResultWire<SessionConsistencyValue>> {
    throw new Error("sessionAdmin/consistency：契约类未实现（宿主侧要在子类里实现它）");
  }
}
