// 客户端 `muxTransport` 与我们的 `MuxServer` 的**对接**测试：真 `node:http` + 真 `WebSocket`。
//
// 不启动应用、不开浏览器：两个组件各自真实运行，只在同一进程里握手。
// 这样「帧格式 / streamId / `$events` 分流」这些**接缝**才真的被验证过（各自的单测只覆盖自己那半）。
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { MuxServer } from "../api-gateway/mux-server.service.ts";
import { RemoteHandlersDefault } from "../api-gateway/remote-handlers.service.ts";
import { muxTransport } from "@morlay/zephyr-app/client";

/** 起一个只带 `/api/remote.mux` 的 http server，返回端口与依赖。 */
async function serve(): Promise<{ port: number; handlers: RemoteHandlersDefault; server: Server }> {
  const handlers = new RemoteHandlersDefault();
  const routes: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void }[] = [];
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
    route.handler(req, socket as unknown as Duplex, head);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("没有监听端口");
  return { port: address.port, handlers, server };
}

/** node 的 `WebSocket`（22+ 内置）对 `Duplex` 的适配不需要：直接用它连。 */
function transportOf(port: number): ReturnType<typeof muxTransport> {
  const factory = (): WebSocket => new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`);
  return muxTransport(() => ({ openWebSocket: factory }) as never);
}

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    // upgrade 连接不会被 `closeAllConnections` 收掉：给关闭一个上限，别让清理把用例拖死。
    await Promise.race([close(), new Promise((resolve) => setTimeout(resolve, 300))]);
  }
}, 5_000);

describe("mux 接缝（真 http + 真 WebSocket）", { timeout: 15_000 }, () => {
  it("握手能完成（最小的可达性验证）", async () => {
    const { port, server } = await serve();
    closers.push(async () => {
      // `WebSocket` 还开着，`close()` 会一直等：先掐掉所有连接。
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`);
    const opened = await new Promise<string>((resolve) => {
      socket.addEventListener("open", () => resolve("open"));
      socket.addEventListener("error", (event) => resolve(`error: ${String((event as ErrorEvent).message ?? event)}`));
      socket.addEventListener("close", (event) => resolve(`close: ${String((event as CloseEvent).code)}`));
    });
    socket.close();
    expect(opened).toBe("open");
  });

  it("一次 unary 调用：open → invoke → item → end", async () => {
    const { port, handlers, server } = await serve();
    closers.push(async () => {
      // `WebSocket` 还开着，`close()` 会一直等：先掐掉所有连接。
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    handlers.register("session/list", async () => ({ ids: [], byId: {} }));

    const transport = transportOf(port);
    const value = await transport.invoke("session/list", { args: {} });
    expect(value).toEqual({ ids: [], byId: {} });
  });

  it("`$events` 订阅后，`publish` 的帧能到客户端的 `deliver`", async () => {
    const { port, handlers, server } = await serve();
    closers.push(async () => {
      // `WebSocket` 还开着，`close()` 会一直等：先掐掉所有连接。
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const transport = transportOf(port);
    const received: [string, unknown[]][] = [];
    transport.subscribe?.((channel, ...args) => received.push([channel, args]));

    // 先发一次 unary：建连 + 补发 `$events` 的 open 帧。
    handlers.register("session/ping", async () => "pong");
    await transport.invoke("session/ping", { args: {} });

    // 等订阅在服务端就位，再发布。
    await new Promise((resolve) => setTimeout(resolve, 50));
    handlers.publish("api-session/added", { id: "s1", title: "会话一" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toEqual([["api-session/added", [{ id: "s1", title: "会话一" }]]]);
  });
});
