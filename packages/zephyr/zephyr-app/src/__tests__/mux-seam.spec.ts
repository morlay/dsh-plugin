// 客户端 `muxTransport` 与我们的 `MuxServer` 的**对接**测试：真 `node:http` + 真 `WebSocket`。
//
// 不启动应用、不开浏览器：两个组件各自真实运行，只在同一进程里握手。
// 这样「帧格式 / streamId / `$events` 分流」这些**接缝**才真的被验证过（各自的单测只覆盖自己那半）。
import { afterEach, describe, expect, it } from "vitest";
import { muxTransport } from "@morlay/zephyr-app/client";
import { serveMux } from "./support/mux-serve.ts";
import { subscribedOnce } from "./support/subscribed.ts";
import { within } from "./support/within.ts";

/** 连一条 mux（node 22+ 内置 `WebSocket`）。 */
function transportOf(url: string): ReturnType<typeof muxTransport> {
  const factory = (): WebSocket => new WebSocket(`${url}/api/remote.mux`);
  return muxTransport(() => ({ openWebSocket: factory }) as never);
}

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
}, 5_000);

describe("mux 接缝（真 http + 真 WebSocket）", { timeout: 15_000 }, () => {
  it("一次 unary 调用：open → invoke → item → end", async () => {
    const { url, handlers, close } = await serveMux();
    closers.push(close);
    handlers.register("session/list", async () => ({ ids: [], byId: {} }));

    const transport = transportOf(url);
    const value = await transport.invoke("session/list", { args: {} });
    expect(value).toEqual({ ids: [], byId: {} });
  });

  it("`$events` 订阅后，`publish` 的帧能到客户端的 `deliver`", async () => {
    const { url, handlers, close } = await serveMux();
    closers.push(close);

    const transport = transportOf(url);
    const received: [string, unknown[]][] = [];
    let onFrame: (() => void) | undefined;
    const frameArrived = new Promise<void>((resolve) => {
      onFrame = resolve;
    });
    transport.subscribe?.((channel, ...args) => {
      received.push([channel, args]);
      onFrame?.();
    });

    // 先发一次 unary：建连 + 补发 `$events` 的 open 帧。
    handlers.register("session/ping", async () => "pong");
    // 服务端订阅到目标频道才算就位（open 帧的处理是异步的，不能靠猜时长）。
    const positioned = subscribedOnce(handlers, "api-session/added");
    await transport.invoke("session/ping", { args: {} });
    await within(positioned, 1_000, "`$events` 在服务端订阅就位");
    handlers.publish("api-session/added", { id: "s1", title: "会话一" });
    await within(frameArrived, 1_000, "publish 的帧到客户端的 deliver");

    expect(received).toEqual([["api-session/added", [{ id: "s1", title: "会话一" }]]]);
  });
});

// 两条协议行为都是这轮才补上的，且**错了两边都不报错**：
// - 流迭代提前结束时不发 `cancel`，宿主那条流永远不结（终端下次 attach 抢不到 controller，
//   `writable` 一直是 false，界面上"能看不能输入"）；
// - 没有上行帧，双向流（终端键入）根本没通道。
describe("mux 接缝：流的收尾与上行", { timeout: 15_000 }, () => {
  /** 起服务并在用例后关掉。 */
  const boot = async (overrides: { typert?: unknown; gateway?: unknown } = {}) => {
    const served = await serveMux(overrides);
    closers.push(served.close);
    return served;
  };

  it("提前 `break` 之后宿主那条流要收尾（客户端补发 `cancel`）", async () => {
    const { url, handlers } = await boot();
    let hostAborted = false;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve;
    });
    handlers.registerStream("workspace/follow", async function* (_args, signal) {
      signal.addEventListener(
        "abort",
        () => {
          hostAborted = true;
          onAbort?.();
        },
        { once: true },
      );
      yield { type: "baseline" };
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    });

    const transport = transportOf(url);
    const controller = new AbortController();
    const source = transport.openStream("workspace/follow", { args: {} }, controller.signal);
    for await (const frame of source) {
      void frame;
      break;
    }
    // `cancel` 帧要经 socket 到 host：等它落地，别用固定 sleep 猜。
    await within(aborted, 1_000, "宿主收到 `break` 补发的 cancel");
    expect(hostAborted, "`break` 之后宿主不收到 cancel，那条流就永远挂着").toBe(true);
  });

  it("`send` 的项进 gateway 的 `uplink`，`end` 半关（终端的键入走这条路）", async () => {
    const items: unknown[] = [];
    let onUplinkEnd: (() => void) | undefined;
    const uplinkEnded = new Promise<void>((resolve) => {
      onUplinkEnd = resolve;
    });
    const { url } = await boot({
      // 分流判据：`typert.remotes.get(endpoint)?.mode === 'stream'`。
      typert: { remotes: { get: () => ({ mode: "stream" }) } },
      gateway: {
        stream: async (request: { readonly uplink?: AsyncIterable<unknown> }) => {
          const uplink = request.uplink;
          void (async () => {
            if (uplink === undefined) return;
            for await (const item of uplink) items.push(item);
            onUplinkEnd?.();
          })();
          // 下行不产帧：这条用例只看上行（空迭代器，不 yield）。
          return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
        },
      },
    });

    const transport = transportOf(url);
    const source = transport.openStream(
      "terminal/attach",
      { args: {} },
      new AbortController().signal,
    );
    void source[Symbol.asyncIterator]();
    source.send({ type: "write", sequence: 1, data: "hi" });
    source.end();

    // 宿主那条 uplink 迭代结束 = `end` 半关到了（不用固定 sleep 猜）。
    await within(uplinkEnded, 1_000, "`end` 半关之后宿主 uplink 迭代结束");
    expect(items, "上行项要原样到 gateway").toEqual([{ type: "write", sequence: 1, data: "hi" }]);
  });
});
