// 管理面端点的测试替身：WebServer 记路由、Connection 默认放行，请求 / 响应用最小形状。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Connection } from "@morlay/dsh-base/connection";
import { WebServer } from "@morlay/dsh-base/web-server";

export interface FakeWebServer {
  routes: Map<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>;

  register: WebServer["register"];
}

export function fakeWebServer(): FakeWebServer {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>();
  return {
    routes,
    register(route: Parameters<WebServer["register"]>[0]) {
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  } as unknown as FakeWebServer;
}

export interface FakeConnection {
  rejectWith?: 401 | 403;
  requestRejection: Connection["requestRejection"];
}

export function fakeConnection(rejectWith?: 401 | 403): FakeConnection {
  return {
    ...(rejectWith === undefined ? {} : { rejectWith }),
    requestRejection: () => rejectWith,
  } as unknown as FakeConnection;
}

export interface FakeResponse {
  res: ServerResponse;
  code: number;
  body: string;
  headers: Record<string, string>;
}

export function fakeResponse(): FakeResponse {
  const state = {
    res: undefined as unknown as ServerResponse,
    code: 0,
    body: "",
    headers: {} as Record<string, string>,
  };
  state.res = {
    writeHead: (code: number, headers?: Record<string, string>) => {
      state.code = code;
      if (headers !== undefined) Object.assign(state.headers, headers);
      return state.res;
    },
    end: (chunk?: string | Buffer) => {
      if (chunk !== undefined) state.body = chunk.toString();
    },
  } as unknown as ServerResponse;
  return state;
}

export function fakeRequest(method = "POST", body: unknown = {}): IncomingMessage {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    },
  } as unknown as IncomingMessage;
}

// 测试只关心「注册了哪些路由」与 handler 的响应。
export async function callRoute(
  server: FakeWebServer,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const handler = server.routes.get(path);
  if (handler === undefined) throw new Error(`route "${path}" is not registered`);
  await handler(req, res);
}
