// @vitest-environment happy-dom
/**
 * `muxTransport` 的**局部闭环**：用一个可控的假 WebSocket 喂帧。
 *
 * 这是 `mockTransport` 覆盖不到的那一段——建连、排队、`open`/`item`/`error`/`end` 帧解析、
 * `$events` 分流。真实浏览器里的问题只能在这里复现，e2e 不该当第一层调试手段。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { muxTransport } from "../remote-transport.ts";
import { FakeSocket } from "./fake-socket.ts";

/** 把全局 `WebSocket` 换成给定实例（生产实现直接 `new WebSocket(...)`）。 */
function transportOf(socket: FakeSocket) {
  vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket { return socket; } as never);
  return muxTransport();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("muxTransport", { timeout: 5_000 }, () => {
  it("未 open 时先把 open 帧排队，open 之后才真的发出去", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);

    const pending = transport.invoke("session/list", { args: {} });
    expect(socket.sent, "socket 还没 open，不该发出任何帧").toEqual([]);

    socket.open();
    expect(socket.sent.map((text) => JSON.parse(text))).toEqual([
      { type: "open", streamId: "s1", endpoint: "session/list", payload: { args: {} } },
    ]);

    socket.receive({ type: "item", streamId: "s1", value: { ids: [], byId: {} } });
    socket.receive({ type: "end", streamId: "s1" });
    await expect(pending).resolves.toEqual({ ids: [], byId: {} });
  });

  it("error 帧把 Promise 拒掉，并带上宿主的消息", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);

    const pending = transport.invoke("session/create", { args: {} });
    socket.open();
    socket.receive({ type: "error", streamId: "s1", error: { code: "gateway/bad-request", message: "boom", details: {} } });
    await expect(pending).rejects.toThrow("boom");
  });

  it("openStream：item 逐帧到达，end 结束迭代", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    const controller = new AbortController();
    const stream = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();

    const first = iterator.next();
    socket.open();
    expect(socket.framesSent()).toEqual([
      { type: "open", streamId: "s1", endpoint: "workspace/follow", payload: { args: {} } },
    ]);

    socket.receive({ type: "item", streamId: "s1", value: { type: "baseline" } });
    await expect(first).resolves.toEqual({ value: { type: "baseline" }, done: false });

    const second = iterator.next();
    socket.receive({ type: "item", streamId: "s1", value: { type: "order" } });
    await expect(second).resolves.toEqual({ value: { type: "order" }, done: false });

    const third = iterator.next();
    socket.receive({ type: "end", streamId: "s1" });
    await expect(third).resolves.toEqual({ value: undefined, done: true });
  });

  it("openStream：abort 时发 cancel 帧并结束迭代", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    const controller = new AbortController();
    const stream = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();

    socket.open();
    const pending = iterator.next();
    controller.abort();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    expect(socket.framesSent()).toContainEqual({ type: "cancel", streamId: "s1" });
  });

  it("$events 帧按 channel 分发给订阅者，且不污染 unary 的 pending", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    const seen: [string, unknown[]][] = [];
    // `subscribe` 在契约里是可选的（mock 实现也提供），mux 实现一定有。
    transport.subscribe?.((channel, ...args) => seen.push([channel, args]));

    const pending = transport.invoke("session/list", { args: {} });
    socket.open();
    // 订阅之后 open 的帧里应包含 `$events` 的 open（与 unary 的 open 并列）。
    const opened = socket.sent.map((text) => JSON.parse(text) as { streamId: string });
    expect(opened.map((frame) => frame.streamId)).toContain("$events");

    socket.receive({ type: "item", streamId: "$events", value: { channel: "api-session/added", args: [{ id: "s1" }] } });
    expect(seen).toEqual([["api-session/added", [{ id: "s1" }]]]);

    socket.receive({ type: "item", streamId: "s1", value: { ids: ["s1"], byId: {} } });
    socket.receive({ type: "end", streamId: "s1" });
    await expect(pending).resolves.toEqual({ ids: ["s1"], byId: {} });
  });

  // 载体断开时**在途调用必须失败**：挂着的 Promise 会把上游 `ConfigFormController` 的串行写队列
  // （`tail` 等前一次结算）堵死，之后所有写请求连帧都发不出去、也不报错——设置面板「点了没反应」就是这个。
  it("socket 断开：在途调用失败而不是挂着，下一次调用在新 socket 上照常发出", async () => {
    const sockets: FakeSocket[] = [];
    vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
      const created = new FakeSocket();
      sockets.push(created);
      return created;
    } as never);
    const transport = muxTransport();

    const first = transport.invoke("settings/mutate", { args: {} });
    sockets[0]?.open();
    sockets[0]?.close();
    await expect(first).rejects.toThrow(/连接已断开/);

    const second = transport.invoke("settings/mutate", { args: {} });
    // 旧 socket 已 close：必须重建，不能在死 socket 上发。
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    expect(sockets[1]?.framesSent()).toEqual([
      { type: "open", streamId: "s2", endpoint: "settings/mutate", payload: { args: {} } },
    ]);
    sockets[1]?.receive({ type: "item", streamId: "s2", value: { ok: true } });
    sockets[1]?.receive({ type: "end", streamId: "s2" });
    await expect(second).resolves.toEqual({ ok: true });
  });

  // 被拒掉的调用不能再在下一个 socket 上补发：否则「调用方以为失败、宿主其实执行了」的幽灵写。
  it("socket 断开：排队帧随在途调用一起丢弃，不在重连后补发", async () => {
    const sockets: FakeSocket[] = [];
    vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
      const created = new FakeSocket();
      sockets.push(created);
      return created;
    } as never);
    const transport = muxTransport();

    // socket 还在 CONNECTING：open 帧进排队
    const first = transport.invoke("settings/mutate", { args: { args: 1 } });
    sockets[0]?.close();
    await expect(first).rejects.toThrow(/连接已断开/);

    const second = transport.invoke("session/list", { args: {} });
    sockets[1]?.open();
    // 新 socket 上只有新调用的帧（`$events` 未订阅时也没有它）。
    expect(sockets[1]?.framesSent()).toEqual([
      { type: "open", streamId: "s2", endpoint: "session/list", payload: { args: {} } },
    ]);
    sockets[1]?.receive({ type: "item", streamId: "s2", value: { ids: [], byId: {} } });
    sockets[1]?.receive({ type: "end", streamId: "s2" });
    await expect(second).resolves.toEqual({ ids: [], byId: {} });
  });
});
