// `sessionAdmin` 这一组的跨端契约：会话管理页（列表 / 删除 / 导入 / 导出 / 整理 / 用量）。
//
// 源包的五条 HTTP 路由（`/api/morlay/v1/session/{rows,delete,import,export,organize,usage}`）在这里
// 收成一组 remote 方法：路径定动作的那层由方法名承担，错误码走 `RemoteResultWire` 的 `error.code`。
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/client/remote";

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
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SessionRowsValue {
  readonly items: readonly SessionRowsItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface SessionDeleteRequest {
  readonly sessionId: string;
}

export interface SessionDeleteValue {
  readonly deleted: string;
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

export interface SessionOrganizeValue {
  readonly stoppedAgents: number;
  readonly orphanSessions: number;
  readonly orphanEvents: number;
  readonly rebuiltSessions: number;
  readonly vacuumed: boolean;
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
  async import(_request: SessionImportRequest): Promise<RemoteResultWire<SessionImportValue>> {
    throw new Error("sessionAdmin/import：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async export(_request: SessionExportRequest): Promise<RemoteResultWire<SessionExportValue>> {
    throw new Error("sessionAdmin/export：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async organize(): Promise<RemoteResultWire<SessionOrganizeValue>> {
    throw new Error("sessionAdmin/organize：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async usage(_request: SessionUsageRequest): Promise<RemoteResultWire<SessionUsageValue>> {
    throw new Error("sessionAdmin/usage：契约类未实现（宿主侧要在子类里实现它）");
  }
}
