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
  vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
    return socket;
  } as never);
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
    socket.receive({
      type: "error",
      streamId: "s1",
      error: { code: "gateway/bad-request", message: "boom", details: {} },
    });
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

  it("openStream：error 帧让迭代抛错（流的失败不是一个无声的 end）", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    const stream = transport.openStream(
      "workspace/follow",
      { args: {} },
      new AbortController().signal,
    );
    const iterator = stream[Symbol.asyncIterator]();

    const first = iterator.next();
    socket.open();
    socket.receive({ type: "error", streamId: "s1", error: { message: "boom" } });
    await expect(first).rejects.toThrow("boom");
    // 迭代已经结束，不会永远挂着。
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
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

    socket.receive({
      type: "item",
      streamId: "$events",
      value: { type: "emit", event: "api-session/added", args: [{ id: "s1" }] },
    });
    expect(seen).toEqual([["api-session/added", [{ id: "s1" }]]]);

    socket.receive({ type: "item", streamId: "s1", value: { ids: ["s1"], byId: {} } });
    socket.receive({ type: "end", streamId: "s1" });
    await expect(pending).resolves.toEqual({ ids: ["s1"], byId: {} });
  });

  it("**先 invoke、后 subscribe** 时也要补开 `$events`（否则推送永远收不到）", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    // 真实时序：第一次 `invoke`（`settings/describe` 之类）早于 `$on` 的注册。
    const pending = transport.invoke("settings/describe", { args: {} });
    socket.open();
    const before = socket.sent.map((text) => JSON.parse(text) as { streamId: string });
    expect(
      before.map((frame) => frame.streamId),
      "建连时还没订阅，不该有 $events",
    ).not.toContain("$events");

    const seen: [string, unknown[]][] = [];
    transport.subscribe?.((channel, ...args) => seen.push([channel, args]));
    // 订阅发生在建连**之后**：必须立刻补一帧 open，否则宿主的推送一条也到不了。
    const after = socket.sent.map((text) => JSON.parse(text) as { streamId: string });
    expect(after.filter((frame) => frame.streamId === "$events").length, "晚注册也要补开").toBe(1);

    socket.receive({
      type: "item",
      streamId: "$events",
      value: { type: "emit", event: "api-session/added", args: [{ id: "s9" }] },
    });
    expect(seen).toEqual([["api-session/added", [{ id: "s9" }]]]);
    socket.receive({ type: "item", streamId: "s1", value: { writable: true, namespaces: [] } });
    socket.receive({ type: "end", streamId: "s1" });
    await expect(pending).resolves.toEqual({ writable: true, namespaces: [] });
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

/**
 * 可答复的转发事件（**审批**与**用户提问**走的就是这条）。
 *
 * 用户故事：工具要升级沙箱（或模型要提问）→ 宿主发起一条 waterfall → 浏览器收到请求并作答 →
 * 宿主拿到那个答案、工具继续跑。缺任何一段，用户看到的都是
 * `requires approval, but no approval channel is available`（请求根本没有通道）。
 *
 * 这几条钉的是**协议**：`ready` 帧先给 clientId，`waterfall` 帧带 `agentId` 与已投影的
 * `request`（**不带** `agent` / `signal`——它们不可 JSON 化，带上就是
 * `Converting circular structure to JSON`），答复走 unary 端点 `$events/result`。
 */
describe("可答复的转发事件（审批 / 提问）", { timeout: 5_000 }, () => {
  /** 等条件成立（帧分派是微任务链）。 */
  async function until(check: () => boolean, timeoutMs = 1_000): Promise<void> {
    for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("收到审批请求 → 处理者拿到已投影的请求 → 答复回到宿主", async () => {
    const socket = new FakeSocket();
    vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
      return socket;
    } as never);
    const transport = muxTransport();

    const seen: unknown[] = [];
    transport.answer?.(async (invocation) => {
      seen.push({
        event: invocation.event,
        eventId: invocation.eventId,
        agentId: invocation.agentId,
        request: invocation.request,
      });
      return { kind: "result", value: "allowed-once" };
    });
    // 建连由第一次调用触发（生产里 `settings/describe` 总早于事件订阅）。
    void transport.invoke("settings/describe", { args: {} });
    socket.open();

    // 事件流先开，宿主回一条 ready（客户端据此记住自己的身份）。
    expect(socket.framesSent(), "订阅可答复事件后必须开 `$events` 流").toContainEqual({
      type: "open",
      streamId: "$events",
      endpoint: "$events",
      payload: { args: {} },
    });
    socket.receive({
      type: "item",
      streamId: "$events",
      value: { type: "ready", clientId: "c1", host: { home: "http://host" } },
    });
    socket.receive({
      type: "item",
      streamId: "$events",
      value: {
        type: "waterfall",
        event: "approval/request",
        eventId: "e1",
        agentId: "a1",
        request: { toolName: "bash", reason: "需要写文件" },
      },
    });

    await until(() => seen.length > 0);
    expect(seen, "请求必须原样到达处理者").toEqual([
      {
        event: "approval/request",
        eventId: "e1",
        agentId: "a1",
        request: { toolName: "bash", reason: "需要写文件" },
      },
    ]);
    await until(() =>
      socket
        .framesSent()
        .some((frame) => (frame as { endpoint?: string }).endpoint === "$events/result"),
    );
    const answer = socket
      .framesSent()
      .find((frame) => (frame as { endpoint?: string }).endpoint === "$events/result");
    expect(answer, "答复必须带 clientId / eventId / outcome 回宿主").toMatchObject({
      type: "open",
      endpoint: "$events/result",
      payload: {
        args: {
          clientId: "c1",
          eventId: "e1",
          outcome: { kind: "result", value: "allowed-once" },
        },
      },
    });
  });

  it("宿主撤回请求（`cancel` 帧）：处理者手里的信号被 abort", async () => {
    const socket = new FakeSocket();
    vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
      return socket;
    } as never);
    const transport = muxTransport();

    let signal: AbortSignal | undefined;
    transport.answer?.(async (invocation) => {
      signal = invocation.signal;
      // 一直等到被取消（宿主撤回）为止。
      await new Promise<void>((resolve) => {
        invocation.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { kind: "next" };
    });
    void transport.invoke("settings/describe", { args: {} });
    socket.open();
    socket.receive({
      type: "item",
      streamId: "$events",
      value: { type: "ready", clientId: "c1", host: { home: "http://host" } },
    });
    socket.receive({
      type: "item",
      streamId: "$events",
      value: {
        type: "waterfall",
        event: "user-questions/request",
        eventId: "e2",
        agentId: "a1",
        request: { questions: [] },
      },
    });
    await until(() => signal !== undefined);
    socket.receive({ type: "item", streamId: "$events", value: { type: "cancel", eventId: "e2" } });
    await until(() => signal?.aborted === true);
    expect(signal?.aborted, "撤回的请求不能再让界面等下去").toBe(true);
  });
});
