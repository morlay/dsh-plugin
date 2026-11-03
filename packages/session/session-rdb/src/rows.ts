import type { Context } from "@deepseek-ai/cordis";
import type { Backend } from "./backend.ts";
import { SESSION_ROWS_PATH } from "./routes.ts";
import { mountJsonRoute } from "./http/route.ts";

// 管理面的会话列表路由：完整语料（含归档）+ 标题 + 最后活动时间，与官方 `session/list` 分开
// （见 ADR-会话列表两条路）。
export { SESSION_ROWS_PATH };

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

// 一页的条数上限：超过就按上限截断（这个接口给页面用，不是导出通道）。
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;

export function registerSessionRows(ctx: Context, getBackend: () => Promise<Backend>): void {
  mountJsonRoute(ctx, {
    path: SESSION_ROWS_PATH,
    handle: async (body) => {
      const envelope = body as SessionRowsRequest;
      const page =
        Number.isSafeInteger(envelope.page) && (envelope.page ?? 0) > 0 ? envelope.page! : 1;
      const requested = envelope.pageSize;
      const pageSize =
        Number.isSafeInteger(requested) && (requested ?? 0) > 0
          ? Math.min(requested!, MAX_PAGE_SIZE)
          : DEFAULT_PAGE_SIZE;
      const backend = await getBackend();
      const { items, total } = await backend.listSessionRows({
        ...(envelope.query === undefined ? {} : { query: envelope.query }),
        ...(envelope.includeSubagents === undefined
          ? {}
          : { includeSubagents: envelope.includeSubagents }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { body: { items, total, page, pageSize } satisfies SessionRowsValue };
    },
    statusOfError: () => undefined,
  });
}
