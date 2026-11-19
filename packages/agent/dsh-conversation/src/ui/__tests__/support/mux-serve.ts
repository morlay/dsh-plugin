// 只服务 `/api/remote.mux` 的 http server：把 `MuxServer` 的 upgrade 路由挂上去。
//
// 用真 `http` + 真 `WebSocket`（node 侧）：这条缝的两端都是协议，不是平台，
// 所以不需要浏览器就能验「客户端 transport ↔ 服务端帧分发」。
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { MuxServer, RemoteHandlersDefault } from "@morlay/zephyr-app";

/** 起一个 mux server，返回它的 url、路由表、事件源入口与关闭句柄。 */
export async function serveMux(): Promise<{
  url: string;
  handlers: RemoteHandlersDefault;
  server: Server;
  /** 往「转发事件源」推一帧（上游 `\$events` 流的 `emit` / `waterfall` 帧）。 */
  push: (frame: unknown) => void;
}> {
  const handlers = new RemoteHandlersDefault();
  /** 每条流一个队列（测试侧 `push` 往 `$events` 塞帧）。 */
  const queues = new Map<string, unknown[]>();
  const wakes = new Map<string, () => void>();
  const queueOf = (endpoint: string): unknown[] => {
    const existing = queues.get(endpoint);
    if (existing !== undefined) return existing;
    const created: unknown[] = [];
    queues.set(endpoint, created);
    return created;
  };
  const routes: {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  }[] = [];
  const mux = new MuxServer();
  // `Object.assign` 的返回类型是"目标 & 来源"，来源字段不必先断言成索引签名。
  Object.assign(mux, {
    handlers,
    webServer: {
      registerUpgrade: (route: { path: string }) => {
        routes.push(route as never);
        return () => {};
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    disposeRoute: undefined,
    // 本夹具不装 DI：`typert` 没有提供者，显式关掉流式分流（否则读到的是未填充的注入占位）。
    typertOverride: undefined,
    // gateway 同理：路由表没命中的端点（`session/control` 这类流）回落时不能拿到注入占位，
    // 给一个明确"没有实现"的替身，报错点才停在协议层而不是 `invoke is not a function`。
    gateway: {
      invoke: async () => {
        throw new Error("[remote] 没有实现");
      },
      // 浏览器答复（"$events/result"）的入口：替身收下即算结算。
      dispatchWire: async () => ({ ok: true as const, value: undefined }),
      // `\$events` 这条流由 gateway 的转发事件源供给（宿主侧是 `api-remotes` + `typertGateway`）。
      // 本夹具用一个可推帧的队列替身：断言「宿主推什么，客户端就收到什么」。
      wireStream: {
        // **按 endpoint 分队列**：`session/control` 这类流与 `$events` 是两条独立的流，
        // 共用一个队列会让先打开的流把事件帧吞掉（症状：推送永远收不到）。
        open: async (endpoint: string): Promise<AsyncIterable<unknown>> => {
          const list = queueOf(endpoint);
          const ready =
            endpoint === "$events"
              ? [{ type: "ready", clientId: "fixture", host: { home: "/tmp" } }]
              : [];
          return {
            async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
              for (const frame of ready) yield frame;
              for (;;) {
                const next = list.shift();
                if (next !== undefined) {
                  yield next;
                  continue;
                }
                await new Promise<void>((resolve) => {
                  wakes.set(endpoint, resolve);
                });
              }
            },
          };
        },
        failure: () => ({ code: "gateway/invoke-failed", message: "x", details: {} }),
      },
    },
  });
  mux.onInit();

  // 两级 wire：unary 走 `/api/<endpoint>` 的 HTTP RPC（上游的 client-request 信封），
  // 流式与事件流走 `/api/remote.mux` 的 upgrade。夹具把两面都挂在同一个 server 上。
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "/";
    if (req.method !== "POST" || !path.startsWith("/api/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const endpoint = path.slice("/api/".length);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      void (async () => {
        const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          readonly rpcId?: string;
          readonly payload?: { readonly args?: Record<string, unknown> };
        };
        const result = await handlers.invoke(endpoint, envelope.payload?.args ?? {}).then(
          (value) => ({ ok: true, value }),
          (error: unknown) => ({
            ok: false,
            error: { code: "gateway/invoke-failed", message: String(error), details: {} },
          }),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "server-response", rpcId: envelope.rpcId, result }));
      })();
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0] ?? "/";
    const route = routes.find((entry) => entry.path === path);
    if (route === undefined) {
      socket.destroy();
      return;
    }
    route.handler(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("没有监听端口");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    handlers,
    server,
    push: (frame: unknown) => {
      queueOf("$events").push(frame);
      const resume = wakes.get("$events");
      wakes.delete("$events");
      resume?.();
    },
  };
}

/** 关掉 server（不给 socket 留悬挂连接，测试才不会卡 10s）。 */
export async function closeMux(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await Promise.race([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise((resolve) => setTimeout(resolve, 300)),
  ]);
}
