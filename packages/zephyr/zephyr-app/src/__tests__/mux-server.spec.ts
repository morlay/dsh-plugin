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

/** 假的 upgrade socket：只收集写出的字节，并允许测试侧注入数据。 */
class FakeDuplex extends EventEmitter {
  readonly chunks: Buffer[] = [];

  destroyed = false;

  write(chunk: Buffer | string): boolean {
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
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
  const header = length < 126 ? Buffer.from([0x81, 0x80 | length]) : Buffer.from([0x81, 0x80 | 126, length >> 8, length & 0xff]);
  return Buffer.concat([header, mask, masked]);
}

/** 造一个 `MuxServer`（只装它需要的两个依赖）。 */
function muxOf(): { server: MuxServer; handlers: RemoteHandlersDefault; socket: FakeDuplex } {
  const handlers = new RemoteHandlersDefault();
  const routes: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void }[] = [];
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
  });
  server.onInit();
  const socket = new FakeDuplex();
  const request = { headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } } as unknown as IncomingMessage;
  routes[0]?.handler(request, socket as unknown as Duplex, Buffer.alloc(0));
  return { server, handlers, socket };
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
    socket.feed(clientFrame(JSON.stringify({ type: "open", streamId: "s1", endpoint: "session/list", payload: { args: {} } })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const frames = socket.texts().map((text) => JSON.parse(text) as { type: string; streamId: string; value?: unknown });
    expect(frames).toEqual([
      { type: "item", streamId: "s1", value: { ids: [], byId: {} } },
      { type: "end", streamId: "s1" },
    ]);
  });

  it("流式 endpoint：逐帧 item，自然结束后发 end", async () => {
    const { handlers, socket } = muxOf();
    handlers.registerStream("workspace/follow", async function* () {
      yield { type: "baseline", value: { items: [] } };
      yield { type: "order", workspaceIds: ["w1"] };
    });
    socket.feed(clientFrame(JSON.stringify({ type: "open", streamId: "w1", endpoint: "workspace/follow", payload: { args: {} } })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const frames = socket.texts().map((text) => JSON.parse(text) as { type: string; streamId: string; value?: unknown });
    expect(frames).toEqual([
      { type: "item", streamId: "w1", value: { type: "baseline", value: { items: [] } } },
      { type: "item", streamId: "w1", value: { type: "order", workspaceIds: ["w1"] } },
      { type: "end", streamId: "w1" },
    ]);
  });

  it("cancel 帧让流停止：不再发帧，也不发 end", async () => {
    const { handlers, socket } = muxOf();
    let aborted = false;
    handlers.registerStream("workspace/follow", async function* (_args, signal) {
      yield { type: "baseline" };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
      yield { type: "after-abort" };
    });
    socket.feed(clientFrame(JSON.stringify({ type: "open", streamId: "w1", endpoint: "workspace/follow", payload: { args: {} } })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    socket.feed(clientFrame(JSON.stringify({ type: "cancel", streamId: "w1" })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const frames = socket.texts().map((text) => JSON.parse(text) as { type: string; value?: unknown });
    expect(frames).toEqual([{ type: "item", streamId: "w1", value: { type: "baseline" } }]);
    expect(aborted).toBe(true);
  });

  it("$events 订阅后，五条会话频道都能把一帧写回同一条 socket", async () => {
    const { handlers, socket } = muxOf();
    socket.feed(clientFrame(JSON.stringify({ type: "open", streamId: "$events", endpoint: "$events", payload: { args: {} } })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // 上游 `session-controller/src/remote-events.ts` 声明的 5 条；少一条客户端就收不到那类变化。
    handlers.publish("api-session/added", { id: "s1", title: "会话一" });
    handlers.publish("api-session/removed", "s1");
    handlers.publish("api-session/status", "s1", true);
    handlers.publish("api-session/activity", "s1", 1_700_000_000_000);
    handlers.publish("api-session/error", "s1", "provider 挂了");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const frames = socket.texts().map((text) => JSON.parse(text) as { type: string; value?: { channel?: string } });
    expect(frames.map((frame) => frame.value?.channel)).toEqual([
      "api-session/added",
      "api-session/removed",
      "api-session/status",
      "api-session/activity",
      "api-session/error",
    ]);
  });
});
