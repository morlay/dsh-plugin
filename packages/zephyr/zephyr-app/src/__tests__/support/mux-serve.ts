// 只服务 `/api/remote.mux` 的 http server：把 `MuxServer` 的 upgrade 路由挂上去。
//
// 用真 `http` + 真 `WebSocket`（node 侧）：这条缝的两端都是协议，不是平台，
// 所以不需要浏览器就能验「客户端 transport ↔ 服务端帧分发」。
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { MuxServer } from "../../api-gateway/mux-server.service.ts";
import { RemoteHandlersDefault } from "../../api-gateway/remote-handlers.service.ts";

/**
 * 起一个 mux server，返回它的基址、路由表与关闭句柄。
 * @param overrides - 上游面：`typert`（流式分流要查 `remotes.get(endpoint)?.mode`）与 `gateway`。
 */
export async function serveMux(overrides: { typert?: unknown; gateway?: unknown } = {}): Promise<{
  /** mux 的基址（`:8080/api/remote.mux` 前面的那截）。 */
  url: string;
  handlers: RemoteHandlersDefault;
  /** 关掉 server 与**所有已升级的连接**。 */
  close: () => Promise<void>;
}> {
  const handlers = new RemoteHandlersDefault();
  const routes: {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  }[] = [];
  /** 升级后的连接：`server.close()` 不收它们，得自己掐。 */
  const upgraded = new Set<Duplex>();
  const mux = new MuxServer();
  Object.assign(mux as unknown as Record<string, unknown>, {
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
    typertOverride: "typert" in overrides ? overrides.typert : undefined,
    // gateway 同理：路由表没命中的端点（`session/control` 这类流）回落时不能拿到注入占位，
    // 给一个明确"没有实现"的替身，报错点才停在协议层而不是 `invoke is not a function`。
    ...("gateway" in overrides
      ? { gateway: overrides.gateway }
      : {
          gateway: {
            invoke: async () => {
              throw new Error("[remote] 没有实现");
            },
          },
        }),
  });
  mux.onInit();

  const server: Server = createServer((_req, res) => {
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
    upgraded.add(socket as unknown as Duplex);
    socket.once("close", () => upgraded.delete(socket as unknown as Duplex));
    route.handler(req, socket as unknown as Duplex, head);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("没有监听端口");
  const url = `ws://127.0.0.1:${String(address.port)}`;

  // `server.close()` 只等 http 连接；upgrade 之后的 socket 已经不在 server 的连接表里
  // （`closeAllConnections()` 也不收），不先掐掉就要一直等到测试的兜底超时——每个用例白等 300ms。
  const close = async (): Promise<void> => {
    for (const socket of upgraded) socket.destroy();
    upgraded.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { url, handlers, close };
}
