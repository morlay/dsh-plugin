import type { SessionId } from "@deepseek-ai/dsh-session";

/** host 侧已存在的会话路由。 */
export const SESSION_DELETE_PATH = "/api/session.delete";
export const SESSION_IMPORT_PATH = "/api/session.import";
export const SESSION_EXPORT_PATH = "/api/session.export";
export const SESSION_GC_PATH = "/api/session.gc";
export const SESSION_USAGE_PATH = "/api/session.usage";

/**
 * 管理面的会话行（**完整语料，含归档**）：我们自己的路由，与官方 `session/list` 分开——那条按部署策略
 * 默认排除归档（给上游 UI 用），归档集的管理动作需要完整集合。
 */
export const SESSION_ROWS_PATH = "/api/session.rows";

/** 一行会话：标题、origin、最后活动时间、归档标记与工作区归属都由 host 给出。 */
export interface SessionRowRecord {
  sessionId: string;
  title: string | null;
  origin: string | null;
  cwd: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  workspace: string | null;
}

/** 列表请求：搜索、子代理过滤与分页都在后端做（前端分页等于每次拉全量）。 */
export interface SessionRowsQuery {
  query?: string;
  includeSubagents?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SessionRowsPage {
  items: SessionRowRecord[];
  /** 过滤后的总数（分页前），页面据此算页数。 */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 时间范围的语义键（与 session-rdb `./usage` 的 `UsageRangeKey` 镜像）：`day` / `week` 是本地自然日 /
 * 自然周，`7d` / `30d` / `90d` 是最近 N 个自然日（含今天）——边界由 host 按本地时区算，客户端只传语义。
 */
export type UsageRangeKey = "all" | "day" | "week" | "7d" | "30d" | "90d";

/** 活动计数（与 session-rdb `./usage` 的回报结构镜像）：轮次 / 步骤 / 用户输入 / 工具调用。 */
export interface UsageActivityTotals {
  turns: number;
  steps: number;
  userInputs: number;
  toolCalls: number;
}

/** 一段用量合计：token 用量 + 活动计数。 */
export interface UsageTotals extends UsageActivityTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

/** 一天 × 一个模型 × 是否子代理 的用量桶：活动计数没有模型归属，只有 token 用量。 */
export interface UsageBucket {
  day: string;
  provider: string | null;
  model: string | null;
  subagent: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

/** 一条会话的用量行。 */
export interface UsageSessionRow extends UsageTotals {
  sessionId: string;
  title: string | null;
  subagent: boolean;
  archived: boolean;
}

/** 一次统计请求的回报：总览 + subagent 拆分 + 桶 + 会话行。 */
export interface SessionUsageReport {
  totals: UsageTotals;
  subagent: UsageTotals;
  /** 只被人类会话引用的部分。 */
  human: UsageTotals;
  buckets: UsageBucket[];
  sessions: UsageSessionRow[];
}

/** 页面之外的服务面：归档状态与列表刷新都归它们的既有 owner。 */
export interface ConversationManagerPorts {
  archiveSession(sessionId: SessionId): Promise<void>;
  unarchiveSession(sessionId: SessionId): Promise<void>;
  refresh(): Promise<void>;
}

/** GC 一次执行的回报。 */
export interface ConversationManagerGcResult {
  orphanSessions: number;
  orphanEvents: number;
  stoppedAgents: number;
}

/** 页面从注入面拿到的动作（属性语法：页面解构后直接调用，不绑 this）。 */
export interface ConversationManagerFace {
  /** 管理面自己的列表：完整语料（含归档），标题与最后活动时间随行给出；搜索与分页都在后端。 */
  listRows: (query?: SessionRowsQuery) => Promise<SessionRowsPage>;
  archive: (sessionId: SessionId) => Promise<void>;
  unarchive: (sessionId: SessionId) => Promise<void>;
  remove: (sessionId: SessionId) => Promise<void>;
  exportZip: (sessionId: SessionId) => Promise<void>;
  importZip: (file: File) => Promise<SessionId>;
  collectGarbage: () => Promise<ConversationManagerGcResult>;
  loadUsage: (range: UsageRangeKey) => Promise<SessionUsageReport>;
}

/** 带 host 错误码的请求失败：页面据此选本地化文案。 */
export class ConversationManagerRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "ConversationManagerRequestError";
  }
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    code?: unknown;
  };
  if (!response.ok) {
    throw new ConversationManagerRequestError(
      typeof value.error === "string" ? value.error : `请求失败：HTTP ${response.status}`,
      typeof value.code === "string" ? value.code : undefined,
    );
  }
  return value;
}

async function zipBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("failed to read the selected file"));
    };
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

/** 页面的动作：host 交互收在这里，页面只见数据与回调。 */
export class ConversationManagerController {
  readonly face: ConversationManagerFace;

  constructor(private readonly ports: ConversationManagerPorts) {
    this.face = {
      listRows: (query) => this.loadRows(query),
      archive: (sessionId) => this.ports.archiveSession(sessionId),
      unarchive: (sessionId) => this.ports.unarchiveSession(sessionId),
      remove: (sessionId) => this.remove(sessionId),
      exportZip: (sessionId) => this.exportZip(sessionId),
      importZip: (file) => this.importZip(file),
      collectGarbage: () => this.collectGarbage(),
      loadUsage: (range) => this.loadUsage(range),
    };
  }

  private async loadRows(query: SessionRowsQuery = {}): Promise<SessionRowsPage> {
    const value = await postJson(SESSION_ROWS_PATH, query);
    const items = value["items"];
    if (!Array.isArray(items) || typeof value["total"] !== "number") {
      throw new ConversationManagerRequestError("会话列表响应不可用", undefined);
    }
    return {
      items: items as SessionRowRecord[],
      total: value["total"],
      page: typeof value["page"] === "number" ? value["page"] : (query.page ?? 1),
      pageSize: typeof value["pageSize"] === "number" ? value["pageSize"] : (query.pageSize ?? 20),
    };
  }

  private async remove(sessionId: SessionId): Promise<void> {
    await postJson(SESSION_DELETE_PATH, { sessionId });
    await this.ports.refresh();
  }

  private async exportZip(sessionId: SessionId): Promise<void> {
    const response = await fetch(SESSION_EXPORT_PATH, {
      method: "POST",
      headers: { accept: "application/zip", "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        code?: unknown;
      };
      throw new ConversationManagerRequestError(
        typeof value.error === "string" ? value.error : `请求失败：HTTP ${response.status}`,
        typeof value.code === "string" ? value.code : undefined,
      );
    }
    downloadBlob(
      await response.blob(),
      filenameOf(response.headers.get("content-disposition"), String(sessionId)),
    );
  }

  private async importZip(file: File): Promise<SessionId> {
    const zip = await zipBase64(file);
    const value = await postJson(SESSION_IMPORT_PATH, { zip });
    await this.ports.refresh();
    return value["sessionId"] as SessionId;
  }

  private async collectGarbage(): Promise<ConversationManagerGcResult> {
    const value = await postJson(SESSION_GC_PATH, {});
    await this.ports.refresh();
    return {
      orphanSessions: typeof value["orphanSessions"] === "number" ? value["orphanSessions"] : 0,
      orphanEvents: typeof value["orphanEvents"] === "number" ? value["orphanEvents"] : 0,
      stoppedAgents: typeof value["stoppedAgents"] === "number" ? value["stoppedAgents"] : 0,
    };
  }

  /**
   * 用量统计：host 侧聚合，前端各维度本地折叠。
   * @param range - 时间范围语义键（`all` 不限、`day`/`week` 自然日/周、其余最近 N 天）。
   */
  private async loadUsage(range: UsageRangeKey): Promise<SessionUsageReport> {
    const value = await postJson(SESSION_USAGE_PATH, { range });
    const report = value as unknown as Partial<SessionUsageReport>;
    if (
      report.totals === undefined ||
      !Array.isArray(report.buckets) ||
      !Array.isArray(report.sessions)
    ) {
      throw new ConversationManagerRequestError("用量统计响应不可用", undefined);
    }
    return report as SessionUsageReport;
  }
}

/** 导出文件名优先取 host 给的 Content-Disposition。 */
function filenameOf(disposition: string | null, sessionId: string): string {
  const matched = disposition === null ? null : /filename="([^"]+)"/u.exec(disposition);
  return matched?.[1] ?? `${sessionId}.zip`;
}

/** 浏览器下载：blob URL + 一次性 anchor；URL 在下一轮事件循环回收。 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
