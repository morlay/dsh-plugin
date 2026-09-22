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
}

export interface SessionRowsValue {
  items: SessionRowsItem[];
}

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
            try {
              const items = (await backend.listSessionRows()).map((row) => ({
                sessionId: row.sessionId,
                title: row.title,
                origin: row.origin,
                cwd: row.cwd,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                archived: row.archived,
              }));
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ items } satisfies SessionRowsValue));
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
