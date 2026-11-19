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
  push(frame: unknown): void;
}> {
  const handlers = new RemoteHandlersDefault();
  /** 事件源队列（测试侧 `push` 往里塞帧）。 */
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
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
      // `\$events` 这条流由 gateway 的转发事件源供给（宿主侧是 `api-remotes` + `typertGateway`）。
      // 本夹具用一个可推帧的队列替身：断言「宿主推什么，客户端就收到什么」。
      wireStream: {
        open: async (): Promise<AsyncIterable<unknown>> => ({
          async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
            for (;;) {
              const next = queue.shift();
              if (next !== undefined) {
                yield next;
                continue;
              }
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          },
        }),
        failure: () => ({ code: "gateway/invoke-failed", message: "x", details: {} }),
      },
    },
  });
  mux.onInit();

  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
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
      queue.push(frame);
      const resume = wake;
      wake = undefined;
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
