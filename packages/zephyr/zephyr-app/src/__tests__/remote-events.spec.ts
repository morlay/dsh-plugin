// 转发事件的**来源**（宿主半）装上了没有。
//
// 用户看得见的两类后果都从这一行来：
// - `emit` 通知（`api-session/status` 这些）：少了它，浏览器里会话永远不显示"正在运行"、侧栏也不跟着增删；
// - `waterfall` 请求（`approval/request`、用户提问）：少了它，工具请求升级沙箱时上游直接 fail closed
//   （`requires approval, but no approval channel is available`），批准按钮根本不会出现。
//
// 判据：装 `RemoteEventsSource` 后，上游 gateway 上**登记了**一条转发事件源，且迭代它时能收到宿主
// `ctx.emit` 的通知帧；不装时这条登记是空的（否则"装上了"无从判断）。
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteEventsSource } from "../api-gateway/remote-events.service.ts";
import { TypertGateway } from "../typert/gateway.contract.ts";

/** 一帧转发事件（上游 `TypertRemoteEventDispatch` 的子集）。 */
interface Frame {
  readonly event?: string;
  readonly args?: readonly unknown[];
}

/** `TypertGateway` 的替身：只实现「登记事件源」这一面（本 spec 不走调用与流）。 */
@Injectable()
class FakeGateway extends TypertGateway {
  readonly registered: Array<() => AsyncIterable<Frame>> = [];

  readonly wireStream = {
    open: async (): Promise<AsyncIterable<never>> => {
      throw new Error("本 spec 不走 wire");
    },
    failure: () => ({ code: "x", message: "x", details: {} }),
  };

  async invoke(): Promise<unknown> {
    throw new Error("本 spec 不走调用");
  }

  async stream(): Promise<AsyncIterable<never>> {
    throw new Error("本 spec 不走流");
  }

  hasLiveClient(): boolean {
    return this.registered.length > 0;
  }

  getPendingRemoteEvents(): readonly { readonly event: string; readonly agentId: string }[] {
    return [];
  }

  registerRemoteEvents(
    source: (...args: never[]) => AsyncIterable<Frame>,
    _host: unknown,
  ): () => Promise<void> {
    this.registered.push(source as () => AsyncIterable<Frame>);
    return async () => {};
  }

  async dispatchWire(): Promise<{ readonly ok: true; readonly value: undefined }> {
    throw new Error("本 spec 不走 wire 分派");
  }
}

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/**
 * 起一份宿主 wire 面。
 * @param withSource - 是否装转发事件源这一行。
 * @returns 应用与 gateway 替身。
 */
async function boot(withSource: boolean): Promise<{ app: App; gateway: FakeGateway }> {
  const app = await bootstrapApplication({
    providers: withSource ? [FakeGateway, RemoteEventsSource] : [FakeGateway],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return { app, gateway: app.get(FakeGateway) };
}

describe("转发事件的来源", () => {
  it("装上之后，宿主 emit 的通知会进事件流（浏览器侧的 running 与侧栏靠它）", async () => {
    const { app, gateway } = await boot(true);
    expect(gateway.registered, "RemoteEventsSource 必须把源登记到 gateway 上").toHaveLength(1);

    const source = gateway.registered[0] as (signal: AbortSignal) => AsyncIterable<Frame>;
    const controller = new AbortController();
    const frames: Frame[] = [];
    void (async (): Promise<void> => {
      for await (const frame of source(controller.signal)) frames.push(frame);
    })().catch(() => {});
    // 源在**开流时**才挂监听（上游 `remoteEventSource` 就是这么做的），等它挂上再发。
    await new Promise((resolve) => setTimeout(resolve, 20));
    const emit = Reflect.get(app.ctx, "emit") as (name: string, ...args: unknown[]) => void;
    emit.call(app.ctx, "api-session/status", "s1", true);
    for (let waited = 0; frames.length === 0 && waited < 500; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    controller.abort();
    expect(
      frames.map((frame) => frame.event),
      "通知帧要带原始事件名",
    ).toContain("api-session/status");
  });

  it("反向：不装这一行，gateway 上没有事件源（转发事件一条都出不去）", async () => {
    const { gateway } = await boot(false);
    expect(gateway.registered).toHaveLength(0);
  });
});
