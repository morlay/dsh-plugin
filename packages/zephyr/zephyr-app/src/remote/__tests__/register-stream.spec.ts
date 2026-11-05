// `registerRemoteGroup` 的**流式方法分派**：`follow(request, signal)` 与 `control(signal)` 两种签名。
//
// 这条判据来自真事故：一律按 `(request, signal)` 调用时，`control` 收到的是请求对象而不是取消信号，
// 宿主立刻抛 `signal.addEventListener is not a function`（客户端看到的是
// `[sessions] session/control 结束于错误`）。两种签名都是上游的既定形状，不是可选风格。
import { bootstrapApplication, Injectable, inject } from "@morlay/zephyr";
import { Remote, RemoteGroup } from "../decorators.ts";
import { registerRemoteGroup } from "../register.ts";
import { RemoteHandlers } from "../../api-gateway/remote-handlers.contract.ts";
import { RemoteHandlersDefault } from "../../api-gateway/remote-handlers.service.ts";
import { afterEach, describe, expect, it } from "vitest";

const opened: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

/** 两种签名混合的一组端点（与 `session` 组同形）。 */
@RemoteGroup({ name: "demo" })
class DemoEndpoint {
  /** 带请求：`follow(request, signal)`（`session/follow` 的形状）。 */
  @Remote({ mode: "stream" })
  async *follow(request: { readonly id?: string }, signal: AbortSignal): AsyncGenerator<unknown> {
    yield { got: "request", id: request.id, aborted: signal.aborted };
    yield { got: "still-a-signal", hasListener: typeof signal.addEventListener === "function" };
  }

  /** 不带请求：`control(signal)`（`session/control` 的形状）。 */
  @Remote({ mode: "stream" })
  async *control(signal: AbortSignal): AsyncGenerator<unknown> {
    yield { got: "signal", hasListener: typeof signal.addEventListener === "function" };
  }
}

/** 宿主实现（`registerRemoteGroup` 在 `onInit` 里注册）。 */
@Injectable()
class DemoEndpointDefault extends DemoEndpoint {
  private readonly handlers = injectHandlers();

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }
}

/** handler 表（`inject` 字段初始化时是占位符，`onInit` 前解析）。 */
function injectHandlers(): RemoteHandlers {
  return inject(RemoteHandlers);
}

describe("registerRemoteGroup 的流式分派", () => {
  it("`follow(request, signal)`：请求与取消信号各就各位", async () => {
    const app = await bootstrapApplication({
      providers: [RemoteHandlersDefault, DemoEndpointDefault],
      timeoutMs: 5_000,
    });
    opened.push(app);
    const handlers = app.get(RemoteHandlers);
    const controller = new AbortController();
    const frames: unknown[] = [];
    // wire 形状是 `{ args: { request } }`（命名参数），`requestOf` 取 `args.request`。
    for await (const frame of handlers.stream("demo/follow", { request: { id: "s1" } }, controller.signal) ?? []) {
      frames.push(frame);
    }
    expect(frames).toEqual([
      { got: "request", id: "s1", aborted: false },
      { got: "still-a-signal", hasListener: true },
    ]);
    controller.abort();
  });

  it("`control(signal)`：收到的是取消信号，不是请求对象", async () => {
    const app = await bootstrapApplication({
      providers: [RemoteHandlersDefault, DemoEndpointDefault],
      timeoutMs: 5_000,
    });
    opened.push(app);
    const handlers = app.get(RemoteHandlers);
    const controller = new AbortController();
    const frames: unknown[] = [];
    for await (const frame of handlers.stream("demo/control", {}, controller.signal) ?? []) {
      frames.push(frame);
    }
    expect(frames, "`control` 的第一个实参必须是 AbortSignal").toEqual([
      { got: "signal", hasListener: true },
    ]);
    controller.abort();
  });
});
