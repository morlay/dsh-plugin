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

/**
 * 起一个只带 `/api/remote.mux` 的 http server，返回端口与依赖。
 * @param overrides - 上游面：`typert`（流式分流要查 `remotes.get(endpoint)?.mode`）与 `gateway`。
 */
async function serve(overrides: { typert?: unknown; gateway?: unknown } = {}): Promise<{
  port: number;
  handlers: RemoteHandlersDefault;
  server: Server;
}> {
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
    // `typert` 在本 spec 没有提供者（不装 DI）：显式给 `undefined`，流式分流跳过。
    typertOverride: "typert" in overrides ? overrides.typert : undefined,
    ...("gateway" in overrides ? { gateway: overrides.gateway } : {}),
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

// 两条协议行为都是这轮才补上的，且**错了两边都不报错**：
// - 流迭代提前结束时不发 `cancel`，宿主那条流永远不结（终端下次 attach 抢不到 controller，
//   `writable` 一直是 false，界面上"能看不能输入"）；
// - 没有上行帧，双向流（终端键入）根本没通道。
describe("mux 接缝：流的收尾与上行", { timeout: 15_000 }, () => {
  /** 起服务并在用例后关掉（upgrade 连接不会被 `closeAllConnections` 收掉，给个上限）。 */
  const boot = async (overrides: { typert?: unknown; gateway?: unknown } = {}) => {
    const served = await serve(overrides);
    closers.push(async () => {
      served.server.closeAllConnections?.();
      await new Promise<void>((resolve) => served.server.close(() => resolve()));
    });
    return served;
  };

  it("提前 `break` 之后宿主那条流要收尾（客户端补发 `cancel`）", async () => {
    const { port, handlers } = await boot();
    let hostAborted = false;
    handlers.registerStream("workspace/follow", async function* (_args, signal) {
      signal.addEventListener("abort", () => { hostAborted = true; }, { once: true });
      yield { type: "baseline" };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => { resolve(); }, { once: true });
      });
    });

    const transport = transportOf(port);
    const controller = new AbortController();
    const source = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    for await (const frame of source) {
      void frame;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    expect(hostAborted, "`break` 之后宿主不收到 cancel，那条流就永远挂着").toBe(true);
  });

  it("`send` 的项进 gateway 的 `uplink`，`end` 半关（终端的键入走这条路）", async () => {
    const items: unknown[] = [];
    let uplinkClosed = false;
    const { port } = await boot({
      // 分流判据：`typert.remotes.get(endpoint)?.mode === 'stream'`。
      typert: { remotes: { get: () => ({ mode: "stream" }) } },
      gateway: {
        stream: async (request: { readonly uplink?: AsyncIterable<unknown> }) => {
          const uplink = request.uplink;
          void (async () => {
            if (uplink === undefined) return;
            for await (const item of uplink) items.push(item);
            uplinkClosed = true;
          })();
          // 下行不产帧：这条用例只看上行（空迭代器，不 yield）。
          return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
        },
      },
    });

    const transport = transportOf(port);
    const source = transport.openStream("terminal/attach", { args: {} }, new AbortController().signal);
    void source[Symbol.asyncIterator]();
    source.send({ type: "write", sequence: 1, data: "hi" });
    source.end();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(items, "上行项要原样到 gateway").toEqual([{ type: "write", sequence: 1, data: "hi" }]);
    expect(uplinkClosed, "`end` 半关之后 uplink 迭代要结束").toBe(true);
  });
});
