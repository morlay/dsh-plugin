import type { Context } from "@deepseek-ai/cordis";
import type { Backend } from "./backend.ts";

/**
 * 管理面的会话列表：**我们自己的**一条路由（完整语料，含归档），与官方 `session/list` 分开。
 *
 * 官方那条（`session/list` → `ctx.sessionQuery.listSessions`）按部署策略默认排除已归档——那是给上游
 * UI 用的。归档集的管理动作要有完整列表，所以这里单独给一条：标题直接从会话列取，最后活动时间用
 * 该会话最后一个事件的时间。
 */
export const SESSION_ROWS_PATH = "/api/session.rows";

export interface SessionRowsItem {
  sessionId: string;
  title: string | null;
  /** 会话 header 的 origin（`subagent` 表示子代理会话）。 */
  origin: string | null;
  cwd: string | null;
  createdAt: number;
  /** 最后一个事件的时间（无事件时等于 `createdAt`）。 */
  updatedAt: number;
  archived: boolean;
  /** 所属工作区标题；不属于任何工作区时为 null。 */
  workspace: string | null;
}

/** 请求：搜索、子代理过滤与分页都在后端做——前端分页等于每次拉全量，数据一多就崩。 */
export interface SessionRowsRequest {
  /** 匹配标题或所属工作区标题（大小写不敏感）。 */
  query?: string;
  includeSubagents?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SessionRowsValue {
  items: SessionRowsItem[];
  /** 过滤后的总数（分页前），前端据此算页数。 */
  total: number;
  page: number;
  pageSize: number;
}

/** 一页的条数上限：超过就按上限截断（这个接口给页面用，不是导出通道）。 */
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;

export function registerSessionRows(ctx: Context, backend: Backend): void {
  ctx.inject(["webServer", "connection"] as const, (webCtx) => {
    const webServer = webCtx.webServer as unknown as {
      register(route: {
        kind: "exact";
        path: string;
        handler: (
          req: import("node:http").IncomingMessage,
          res: import("node:http").ServerResponse,
        ) => void | Promise<void>;
      }): () => void;
    };
    const connection = webCtx.get("connection") as unknown as {
      requestRejection(request: {
        headers: import("node:http").IncomingHttpHeaders;
      }): number | undefined;
    };
    return webCtx.effect(
      () =>
        webServer.register({
          kind: "exact",
          path: SESSION_ROWS_PATH,
          handler: async (req, res) => {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
              res.writeHead(rejection);
              res.end(rejection === 401 ? "unauthorized" : "forbidden");
              return;
            }
            if (req.method !== "POST") {
              res.writeHead(405, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "method not allowed" }));
              return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            let envelope: SessionRowsRequest = {};
            if (raw !== "") {
              try {
                envelope = JSON.parse(raw) as SessionRowsRequest;
              } catch {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: "request body is not JSON" }));
                return;
              }
            }
            const page =
              Number.isSafeInteger(envelope.page) && (envelope.page ?? 0) > 0 ? envelope.page! : 1;
            const requested = envelope.pageSize;
            const pageSize =
              Number.isSafeInteger(requested) && (requested ?? 0) > 0
                ? Math.min(requested!, MAX_PAGE_SIZE)
                : DEFAULT_PAGE_SIZE;
            try {
              const { items, total } = await backend.listSessionRows({
                ...(envelope.query === undefined ? {} : { query: envelope.query }),
                ...(envelope.includeSubagents === undefined
                  ? {}
                  : { includeSubagents: envelope.includeSubagents }),
                limit: pageSize,
                offset: (page - 1) * pageSize,
              });
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ items, total, page, pageSize } satisfies SessionRowsValue));
            } catch (error: unknown) {
              res.writeHead(500, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : "session rows failed",
                }),
              );
            }
          },
        }),
      "session-rdb: session rows route",
    );
  });
}
