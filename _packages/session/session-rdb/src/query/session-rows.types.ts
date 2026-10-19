// 管理面会话列表端点的类型面。
export interface SessionRowsItem {
  sessionId: string;
  title: string | null;
  // 会话 header 的 origin（`subagent` 表示子代理会话）。
  origin: string | null;
  cwd: string | null;
  createdAt: number;
  // 最后一个事件的时间（无事件时等于 `createdAt`）。
  updatedAt: number;
  archived: boolean;
  // 所属工作区标题；不属于任何工作区时为 null。
  workspace: string | null;
}

// 请求：搜索、子代理过滤与分页都在后端做——前端分页等于每次拉全量，数据一多就崩。
export interface SessionRowsRequest {
  // 匹配标题或所属工作区标题（大小写不敏感）。
  query?: string;
  includeSubagents?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SessionRowsValue {
  items: SessionRowsItem[];
  // 过滤后的总数（分页前），前端据此算页数。
  total: number;
  page: number;
  pageSize: number;
}
