// 管理面端点的基类：WebServer / Connection 的注入与路由注册只写这一处。
// 上游注册服务的形状（`static inject` + `ctx.provide`）在这里就是 `inject()` + `ctx.effect`。
import { inject, type Context } from "@morlay/zephyr";
import { Connection } from "@morlay/dsh-base/connection";
import { WebServer } from "@morlay/dsh-base/web-server";
import type { IncomingMessage, ServerResponse } from "node:http";

export type WebRoute = Parameters<WebServer["register"]>[0];

export abstract class HttpEndpoint {
  webServer = inject.optional(WebServer);

  // 契约是必需依赖：适配类在 mount 完成后登记到同一令牌，`inject` 会等到它就位（optional 会在
  // 装配早期固定成 undefined，路由就永远不注册）。
  connection = inject(Connection);

  onInit(ctx: Context): void {
    const webServer = this.webServer;
    // 没有 web 面的部署（纯 host / 测试）不注册路由。
    if (webServer === undefined) return;
    ctx.effect(() => webServer.register(this.route()), this.routeLabel);
  }

  protected abstract readonly routeLabel: string;

  protected abstract route(): WebRoute;

  // 子类 handler 只在 `onInit` 注册成功后才会被调用，这里是确定的。
  protected get trust(): Connection {
    if (this.connection === undefined) throw new Error(`${this.routeLabel}: connection is absent`);
    return this.connection;
  }
}

// 返回 true 表示已经写过响应，调用方直接收工。
export function rejectUnauthorized(
  connection: Connection,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const rejection = connection.requestRejection(req);
  if (rejection === undefined) return false;
  res.writeHead(rejection);
  res.end(rejection === 401 ? "unauthorized" : "forbidden");
  return true;
}

export function rejectNonPost(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === "POST") return false;
  respondJson(res, 405, { error: "method not allowed" });
  return true;
}

export function respondJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

export function respondFailure(res: ServerResponse, error: unknown, fallback: string): void {
  respondJson(res, 500, { error: error instanceof Error ? error.message : fallback });
}

// 空 body 返回 undefined（各端点自己决定把它当成 `{}` 还是 400）。
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return undefined;
  return JSON.parse(raw) as unknown;
}

export async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await readJson(req) };
  } catch {
    respondJson(res, 400, { error: "request body is not JSON" });
    return { ok: false };
  }
}
