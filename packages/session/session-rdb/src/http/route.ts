import type { Context } from "@deepseek-ai/cordis";

/** 一条路由自己决定的状态码（鉴权 / 方法 / 解析之外的那些校验）。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface JsonRouteReply {
  status?: number;
  body: unknown;
}

export type JsonRouteHandler = (
  body: unknown,
  webCtx: Context,
) => Promise<JsonRouteReply> | JsonRouteReply;

export interface JsonRouteSpec {
  /** 精确路径（`/api/...`）。 */
  path: string;
  /** 业务处理：拿到解析后的 JSON（空 body 视为 `{}`）；校验失败抛 `HttpError`。 */
  handle: JsonRouteHandler;
  /** 业务错误的状态码映射（没映射的按 500）。 */
  statusOfError?: (error: unknown) => { status: number; body: unknown } | undefined;
}

function writeJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * 挂一条路由：鉴权与方法检查这些每处都一样的部分收在这里。
 *
 * 二进制响应（导出 zip）自己写响应体，所以只共用鉴权 / 405 / 错误兜底。
 */
export function mountRoute(
  ctx: Context,
  path: string,
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => Promise<void>,
): void {
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
          path,
          handler: async (req, res) => {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
              res.writeHead(rejection);
              res.end(rejection === 401 ? "unauthorized" : "forbidden");
              return;
            }
            if (req.method !== "POST") {
              writeJson(res, 405, { error: "method not allowed" });
              return;
            }
            try {
              await handler(req, res);
            } catch (error) {
              if (res.headersSent) return;
              writeJson(res, 500, {
                error: error instanceof Error ? error.message : "request failed",
              });
            }
          },
        }),
      `session-rdb: ${path}`,
    );
  });
}

/**
 * 挂一条 JSON 路由：鉴权、方法、body 解析、错误码这些每处都一样的部分收在这里。
 *
 * 6 个管理面路由（rows / usage / gc / deletion / export / import）共用它——之前每个文件各抄一遍
 * （约 270 行样板，而且 `import` 那条漏了 405）。
 */
export function mountJsonRoute(ctx: Context, spec: JsonRouteSpec): void {
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
          path: spec.path,
          handler: async (req, res) => {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
              res.writeHead(rejection);
              res.end(rejection === 401 ? "unauthorized" : "forbidden");
              return;
            }
            if (req.method !== "POST") {
              writeJson(res, 405, { error: "method not allowed" });
              return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            let body: unknown = {};
            if (raw !== "") {
              try {
                body = JSON.parse(raw);
              } catch {
                writeJson(res, 400, { error: "request body is not JSON" });
                return;
              }
            }
            try {
              const reply = await spec.handle(body, webCtx);
              writeJson(res, reply.status ?? 200, reply.body);
            } catch (error) {
              if (error instanceof HttpError) {
                writeJson(res, error.status, { error: error.message, ...error.payload });
                return;
              }
              const mapped = spec.statusOfError?.(error);
              if (mapped !== undefined) {
                writeJson(res, mapped.status, mapped.body);
                return;
              }
              writeJson(res, 500, {
                error: error instanceof Error ? error.message : "request failed",
              });
            }
          },
        }),
      `session-rdb: ${spec.path}`,
    );
  });
}
