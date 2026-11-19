/**
 * `muxTransport` 的**局部闭环**：用一个可控的假 WebSocket + 假 `fetch` 喂帧。
 *
 * 这是 `mockTransport` 覆盖不到的那一段——建连、排队、`open`/`item`/`error`/`end` 帧解析、
 * `$events` 分流，以及 unary 那条 HTTP RPC。真实浏览器里的问题只能在这里复现，
 * e2e 不该当第一层调试手段。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { muxTransport, type RemoteFetch } from "../remote-transport.ts";
import { FakeSocket } from "./fake-socket.ts";

/** 一次被记录下来的 unary 请求。 */
interface FetchCall {
  readonly url: string;
  readonly body: {
    readonly type?: string;
    readonly rpcId?: string;
    readonly method?: string;
    readonly payload?: unknown;
  };
}

/**
 * 假 HTTP 载体：记录每次请求，按 endpoint 回上游的 `server-response` 信封。
 * @param answer - endpoint（`session/list` 这类）→ 结果，或直接给一个失败信封。
 * @returns 可注入的 `fetch` 与它收到的请求
 */
function fakeFetch(
  answer: (
    endpoint: string,
  ) => { readonly ok: true; readonly value: unknown } | { readonly ok: false },
): { readonly fetchOf: RemoteFetch; readonly calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchOf: RemoteFetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(typeof init.body === "string" ? init.body : "") as FetchCall["body"];
    calls.push({ url, body });
    const result = answer(url.replace(/^\/api\//, ""));
    return new Response(JSON.stringify({ type: "server-response", rpcId: body.rpcId, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchOf, calls };
}

/** 把全局 `WebSocket` 换成给定实例（生产实现直接 `new WebSocket(...)`）。 */
function transportOf(socket: FakeSocket, fetchOf?: RemoteFetch) {
  vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
    return socket;
  } as never);
  return muxTransport(undefined, fetchOf);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("muxTransport", { timeout: 5_000 }, () => {
  it("unary 走 HTTP `/api/<endpoint>`：上游的请求信封与结果解码", async () => {
    const { fetchOf, calls } = fakeFetch(() => ({ ok: true, value: { ids: [], byId: {} } }));
    const transport = transportOf(new FakeSocket(), fetchOf);

    await expect(transport.invoke("session/list", { args: {} })).resolves.toEqual({
      ids: [],
      byId: {},
    });
    expect(calls).toHaveLength(1);
    // 非浏览器宿主回落本机 origin，url 是绝对地址：按路径后缀认。
    expect(String(calls[0]?.url), "unary 的 wire 是 /api 的 HTTP RPC，不是 mux").toMatch(
      /\/api\/session\/list$/u,
    );
    expect(calls[0]?.body).toMatchObject({
      type: "client-request",
      method: "session/list",
      payload: { args: {} },
    });
    expect(typeof calls[0]?.body.rpcId, "rpcId 由发起方铸、宿主原样回").toBe("string");
  });

  it("HTTP 失败信封（`result.ok === false`）抛带 code 的错误", async () => {
    const { fetchOf } = fakeFetch(() => ({ ok: false }));
    const transport = transportOf(new FakeSocket(), fetchOf);
    // 失败信封缺 error 字段时也要有可读的消息（不吞成 undefined）。
    await expect(transport.invoke("session/create", { args: {} })).rejects.toThrow(/调用失败/);
  });

  it("socket 断开：在途**流**失败而不是挂着，下一次开流在新 socket 上照常发出", async () => {
    const sockets: FakeSocket[] = [];
    vi.stubGlobal("WebSocket", function FakeWebSocketCtor(): FakeSocket {
      const created = new FakeSocket();
      sockets.push(created);
      return created;
    } as never);
    const transport = muxTransport();

    const first = transport.openStream(
      "workspace/follow",
      { args: {} },
      new AbortController().signal,
    );
    const firstIterator = first[Symbol.asyncIterator]();
    const firstNext = firstIterator.next();
    sockets[0]?.open();
    sockets[0]?.close();
    await expect(firstNext).rejects.toThrow(/连接已断开/);

    const second = transport.openStream(
      "workspace/follow",
      { args: {} },
      new AbortController().signal,
    );
    const secondIterator = second[Symbol.asyncIterator]();
    const secondNext = secondIterator.next();
    // 旧 socket 已 close：必须重建，不能在死 socket 上发。
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    expect(sockets[1]?.framesSent()).toEqual([
      { type: "open", streamId: "s2", endpoint: "workspace/follow", payload: { args: {} } },
    ]);
    sockets[1]?.receive({ type: "item", streamId: "s2", value: { type: "baseline" } });
    await expect(secondNext).resolves.toEqual({ value: { type: "baseline" }, done: false });
    await secondIterator.return?.(undefined);
  });

  it("unary 不碰 socket：未建连也能成功，且 mux 上一条帧都没有", async () => {
    const socket = new FakeSocket();
    const { fetchOf } = fakeFetch(() => ({ ok: true, value: { ids: [], byId: {} } }));
    const transport = transportOf(socket, fetchOf);

    await expect(transport.invoke("settings/mutate", { args: { args: 1 } })).resolves.toEqual({
      ids: [],
      byId: {},
    });
    expect(socket.sent, "unary 走 HTTP：不该为它建连、也不该发 open 帧").toEqual([]);
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

  it("`$events` 帧按 channel 分发给订阅者", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    const seen: [string, unknown[]][] = [];
    // `subscribe` 在契约里是可选的（mock 实现也提供），mux 实现一定有。
    transport.subscribe?.((channel, ...args) => seen.push([channel, args]));

    // 建连由**流**触发（unary 已不走 socket）。
    const controller = new AbortController();
    const stream = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    void iterator.next();
    socket.open();
    expect(socket.framesSent(), "订阅后建连要开 `$events`").toContainEqual({
      type: "open",
      streamId: "$events",
      endpoint: "$events",
      payload: { args: {} },
    });

    socket.receive({
      type: "item",
      streamId: "$events",
      value: { type: "emit", event: "api-session/added", args: [{ id: "s1" }] },
    });
    expect(seen).toEqual([["api-session/added", [{ id: "s1" }]]]);
  });

  it("**先开流、后 subscribe** 时也要补开 `$events`（否则推送永远收不到）", async () => {
    const socket = new FakeSocket();
    const transport = transportOf(socket);
    const controller = new AbortController();
    const stream = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    void iterator.next();
    socket.open();
    const before = socket.framesSent().map((frame) => (frame as { streamId?: string }).streamId);
    expect(before, "建连时还没订阅，不该有 $events").not.toContain("$events");

    const seen: [string, unknown[]][] = [];
    transport.subscribe?.((channel, ...args) => seen.push([channel, args]));
    // 订阅发生在建连**之后**：必须立刻补一帧 open，否则宿主的推送一条也到不了。
    const after = socket.framesSent().map((frame) => (frame as { streamId?: string }).streamId);
    expect(after.filter((id) => id === "$events").length, "晚注册也要补开").toBe(1);

    socket.receive({
      type: "item",
      streamId: "$events",
      value: { type: "emit", event: "api-session/added", args: [{ id: "s9" }] },
    });
    expect(seen).toEqual([["api-session/added", [{ id: "s9" }]]]);
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
 * `Converting circular structure to JSON`），答复走 unary 端点 `$events/result`（HTTP RPC）。
 */
describe("可答复的转发事件（审批 / 提问）", { timeout: 5_000 }, () => {
  /** 等条件成立（帧分派是微任务链）。 */
  async function until(check: () => boolean, timeoutMs = 1_000): Promise<void> {
    for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("收到审批请求 → 处理者拿到已投影的请求 → 答复经 HTTP 回到宿主", async () => {
    const socket = new FakeSocket();
    const { fetchOf, calls } = fakeFetch(() => ({ ok: true, value: undefined }));
    const transport = transportOf(socket, fetchOf);

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
    // 建连由**流**触发（unary 走 HTTP，不再建 mux）。
    const controller = new AbortController();
    const stream = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    void iterator.next();
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
    // 非浏览器宿主没有 `location`，传输层回落到本机 origin：断言按路径后缀认，不钉死前缀。
    await until(() => calls.some((call) => String(call.url).endsWith("/api/$events/result")));
    const answer = calls.find((call) => String(call.url).endsWith("/api/$events/result"));
    expect(answer, "答复必须带 clientId / eventId / outcome 回宿主").toMatchObject({
      body: {
        type: "client-request",
        method: "$events/result",
        payload: {
          args: {
            clientId: "c1",
            eventId: "e1",
            outcome: { kind: "result", value: "allowed-once" },
          },
        },
      },
    });
  });

  it("宿主撤回请求（`cancel` 帧）：处理者手里的信号被 abort", async () => {
    const socket = new FakeSocket();
    const { fetchOf } = fakeFetch(() => ({ ok: true, value: undefined }));
    const transport = transportOf(socket, fetchOf);

    let signal: AbortSignal | undefined;
    transport.answer?.(async (invocation) => {
      signal = invocation.signal;
      // 一直等到被取消（宿主撤回）为止。
      await new Promise<void>((resolve) => {
        invocation.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { kind: "next" };
    });
    const controller = new AbortController();
    const stream = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    void iterator.next();
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
