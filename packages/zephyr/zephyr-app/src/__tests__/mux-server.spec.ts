// `MuxServer` 的局部闭环：假 `req` + 假 `Duplex`，不起服务、不跑 e2e。
//
// 覆盖三件事：握手（`Sec-WebSocket-Accept`）、`open → invoke → item/end`、
// `$events` 订阅后 `publish` 能把一帧写回同一条 socket。
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { MuxServer } from "../api-gateway/mux-server.service.ts";
import { RemoteHandlersDefault } from "../api-gateway/remote-handlers.service.ts";
import { subscribedOnce } from "./support/subscribed.ts";

/** 服务端写回的一帧（只看 JSON 那些，握手响应不算）。 */
interface OutFrame {
  readonly type: string;
  readonly streamId?: string;
  readonly value?: { readonly channel?: string; readonly [key: string]: unknown };
  readonly error?: unknown;
}

/** 假的 upgrade socket：只收集写出的字节，并允许测试侧注入数据。 */
class FakeDuplex extends EventEmitter {
  readonly chunks: Buffer[] = [];

  destroyed = false;

  write(chunk: Buffer | string): boolean {
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    // 写成事件：异步分派是 promise 链，测试侧等信号而不是猜时长。
    this.emit("write");
    return true;
  }

  end(): void {
    this.destroyed = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** 测试侧「宿主发来一段字节」。 */
  feed(bytes: Buffer): void {
    this.emit("data", bytes);
  }

  /** 已经写出去的**文本帧**（服务端不掩码：`0x81` + 长度 + payload）。 */
  texts(): string[] {
    return this.chunks
      .filter((chunk) => (chunk[0] ?? 0) === 0x81)
      .map((chunk) => {
        const length = chunk[1] ?? 0;
        return chunk.subarray(2, 2 + (length & 0x7f)).toString("utf8");
      });
  }

  /** 已写出的 JSON 帧（握手响应也是文本帧，但它不是 JSON）。 */
  json(): OutFrame[] {
    return this.texts()
      .filter((text) => text.startsWith("{"))
      .map((text) => JSON.parse(text) as OutFrame);
  }

  /** 等写出至少 `count` 条 JSON 帧。 */
  async jsonFrames(count: number): Promise<void> {
    while (this.json().length < count) {
      await new Promise<void>((resolve) => this.once("write", resolve));
    }
  }
}

/** 客户端发一帧文本（带掩码，RFC 6455 要求）。 */
function clientFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = (masked[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  const length = payload.length;
  const header =
    length < 126
      ? Buffer.from([0x81, 0x80 | length])
      : Buffer.from([0x81, 0x80 | 126, length >> 8, length & 0xff]);
  return Buffer.concat([header, mask, masked]);
}

/** 造一个 `MuxServer`（只装它需要的两个依赖）。 */
function muxOf(overrides: Record<string, unknown> = {}): {
  server: MuxServer;
  handlers: RemoteHandlersDefault;
  socket: FakeDuplex;
} {
  const handlers = new RemoteHandlersDefault();
  const routes: {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  }[] = [];
  const server = new MuxServer();
  Object.assign(server as unknown as Record<string, unknown>, {
    handlers,
    webServer: {
      registerUpgrade: (route: { path: string }) => {
        routes.push(route as never);
        return () => {};
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    disposeRoute: undefined,
    // `typert` 在这个 spec 里没有提供者（不装 DI），显式给 `undefined` 让流式分流跳过。
    typertOverride: undefined,
    ...overrides,
  });
  server.onInit();
  const socket = new FakeDuplex();
  const request = {
    headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
  } as unknown as IncomingMessage;
  routes[0]?.handler(request, socket as unknown as Duplex, Buffer.alloc(0));
  return { server, handlers, socket };
}

/**
 * 等 mux 的在途计数变成 `count`（`pump` 的 `finally` 已经跑到）。
 * @param server - 被测 mux。
 * @param count - 期望的在途数。
 */
async function inFlightBecomes(server: MuxServer, count: number): Promise<void> {
  for (let spins = 0; server.inFlight() !== count && spins < 1_000; spins += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(server.inFlight(), `inFlight 应变成 ${String(count)}`).toBe(count);
}

/** 等 mux 上**没有在途调用/流**（cancel / socket 断开之后的收尾）。 */
async function drained(server: MuxServer): Promise<void> {
  await inFlightBecomes(server, 0);
}

describe("MuxServer", { timeout: 5_000 }, () => {
  it("握手按 RFC 6455 回 Sec-WebSocket-Accept", () => {
    const { socket } = muxOf();
    const response = socket.chunks[0]?.toString("utf8") ?? "";
    expect(response).toContain("101 Switching Protocols");
    // 标准样例：key `dGhlIHNhbXBsZSBub25jZQ==` → accept `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`
    expect(response).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("open → invoke → item + end", async () => {
    const { handlers, socket } = muxOf();
    handlers.register("session/list", async () => ({ ids: [], byId: {} }));
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "s1",
          endpoint: "session/list",
          payload: { args: {} },
        }),
      ),
    );
    await socket.jsonFrames(2);
    expect(socket.json()).toEqual([
      { type: "item", streamId: "s1", value: { ids: [], byId: {} } },
      { type: "end", streamId: "s1" },
    ]);
  });

  it("上游 `@Remote({ mode: 'stream' })` 走 gateway 的 stream 载具，不是 unary invoke", async () => {
    // 判据来自 descriptor：`session/control` 是流式端点，用 unary 打开会被上游拒
    // （`stream Remote methods must be opened through the stream carrier`）。
    const streamed: string[] = [];
    const { socket } = muxOf({
      typertOverride: {
        remotes: {
          get: (key: string) => (key === "session/control" ? { mode: "stream" } : undefined),
        },
      },
      gateway: {
        invoke: async () => {
          throw new Error("流式端点不该走 unary");
        },
        stream: async (request: { method: string }) => {
          streamed.push(request.method);
          return (async function* () {
            yield { type: "projection", key: "permissions" };
          })();
        },
      },
    });
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "c1",
          endpoint: "session/control",
          payload: { args: {} },
        }),
      ),
    );
    await socket.jsonFrames(2);
    expect(streamed, "必须走 `gateway.stream`").toEqual(["control"]);
    expect(socket.json()).toEqual([
      { type: "item", streamId: "c1", value: { type: "projection", key: "permissions" } },
      { type: "end", streamId: "c1" },
    ]);
  });

  it("流式 endpoint：逐帧 item，自然结束后发 end", async () => {
    const { handlers, socket } = muxOf();
    handlers.registerStream("workspace/follow", async function* () {
      yield { type: "baseline", value: { items: [] } };
      yield { type: "order", workspaceIds: ["w1"] };
    });
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "w1",
          endpoint: "workspace/follow",
          payload: { args: {} },
        }),
      ),
    );
    await socket.jsonFrames(3);
    expect(socket.json()).toEqual([
      { type: "item", streamId: "w1", value: { type: "baseline", value: { items: [] } } },
      { type: "item", streamId: "w1", value: { type: "order", workspaceIds: ["w1"] } },
      { type: "end", streamId: "w1" },
    ]);
  });

  it("cancel 帧让流停止：不再发帧，也不发 end", async () => {
    const { server, handlers, socket } = muxOf();
    let aborted = false;
    handlers.registerStream("workspace/follow", async function* (_args, signal) {
      yield { type: "baseline" };
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
      yield { type: "after-abort" };
    });
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "w1",
          endpoint: "workspace/follow",
          payload: { args: {} },
        }),
      ),
    );
    // 先等 baseline 写出：流已经在等 cancel。
    await socket.jsonFrames(1);
    socket.feed(clientFrame(JSON.stringify({ type: "cancel", streamId: "w1" })));
    // 等流真的收尾：pump 取下一帧后会看到 aborted 并返回，不再写帧。
    await drained(server);
    expect(aborted).toBe(true);
    expect(socket.json()).toEqual([{ type: "item", streamId: "w1", value: { type: "baseline" } }]);
  });

  it("socket 断开：在途流被取消，不留在 inFlight 里", async () => {
    const { server, handlers, socket } = muxOf();
    let aborted = false;
    handlers.registerStream("workspace/follow", async function* (_args, signal) {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
      yield { type: "after-abort" };
    });
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "w1",
          endpoint: "workspace/follow",
          payload: { args: {} },
        }),
      ),
    );
    // 流真的建立起来（宿主重启/断网时它不能永远挂着）。
    await inFlightBecomes(server, 1);
    socket.emit("close");
    await drained(server);
    expect(aborted, "socket 断开之后宿主那条流必须收到取消").toBe(true);
  });

  it("流式 handler 异步抛错：回 error 帧，不是未捕获拒绝", async () => {
    const { handlers, socket } = muxOf();
    handlers.registerStream("demo/boom", async function* () {
      yield { type: "first" };
      throw new Error("boom");
    });
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "b2",
          endpoint: "demo/boom",
          payload: { args: {} },
        }),
      ),
    );
    await socket.jsonFrames(2);
    expect(socket.json()).toEqual([
      { type: "item", streamId: "b2", value: { type: "first" } },
      {
        type: "error",
        streamId: "b2",
        error: { code: "gateway/invoke-failed", message: "Error: boom", details: {} },
      },
    ]);
  });

  it("unary 在途计数：挂起时算忙，结算后归零（HMR 的忙判据）", async () => {
    const { server, handlers, socket } = muxOf();
    let release: (() => void) | undefined;
    handlers.register(
      "session/list",
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve("ok");
          };
        }),
    );
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "s1",
          endpoint: "session/list",
          payload: { args: {} },
        }),
      ),
    );
    await inFlightBecomes(server, 1);
    release?.();
    await socket.jsonFrames(2);
    await drained(server);
  });

  it("$events 订阅后，五条会话频道都能把一帧写回同一条 socket", async () => {
    const { handlers, socket } = muxOf();
    const positioned = subscribedOnce(handlers, "api-session/added");
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "$events",
          endpoint: "$events",
          payload: { args: {} },
        }),
      ),
    );
    await positioned;
    // 上游 `session-controller/src/remote-events.ts` 声明的 5 条；少一条客户端就收不到那类变化。
    handlers.publish("api-session/added", { id: "s1", title: "会话一" });
    handlers.publish("api-session/removed", "s1");
    handlers.publish("api-session/status", "s1", true);
    handlers.publish("api-session/activity", "s1", 1_700_000_000_000);
    handlers.publish("api-session/error", "s1", "provider 挂了");
    await socket.jsonFrames(5);
    expect(socket.json().map((frame) => frame.value?.channel)).toEqual([
      "api-session/added",
      "api-session/removed",
      "api-session/status",
      "api-session/activity",
      "api-session/error",
    ]);
  });

  // 转发事件是**同步**从 cordis 事件处理器里发出来的（`ForwardedEventsBridge`）：序列化一抛，异常就落进
  // 发布方（agent loop 的异步路径）里，Node 默认会把它当未捕获拒绝退出进程。
  it("转发事件带不可序列化的载荷：publish 不能把序列化错误抛回发布方", () => {
    const { handlers, socket } = muxOf();
    socket.feed(clientFrame(JSON.stringify({ type: "open", streamId: "$e", endpoint: "$events" })));
    // 上游 token 计数是 BigInt：`JSON.stringify` 遇它直接抛 TypeError。
    expect(() => handlers.publish("api-session/status", { tokens: 10n })).not.toThrow();
  });

  it("流式 handler 同步抛错：回 error 帧，不是未捕获拒绝", async () => {
    const { handlers, socket } = muxOf();
    handlers.registerStream("demo/boom", () => {
      throw new Error("boom");
    });
    socket.feed(
      clientFrame(
        JSON.stringify({
          type: "open",
          streamId: "b1",
          endpoint: "demo/boom",
          payload: { args: {} },
        }),
      ),
    );
    await socket.jsonFrames(1);
    expect(socket.json()).toEqual([
      {
        type: "error",
        streamId: "b1",
        error: { code: "gateway/invoke-failed", message: "Error: boom", details: {} },
      },
    ]);
  });
});
