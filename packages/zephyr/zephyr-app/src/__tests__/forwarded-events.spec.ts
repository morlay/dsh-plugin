// 宿主 cordis 事件 → Remote 频道的那座桥。
//
// 判据只有一条：宿主 `ctx.emit('api-session/status', …)` 之后，路由表上的频道订阅者收到同一帧。
// 少了这座桥，浏览器侧的 `session.running` 永远是 false（界面上没有「深度求索中，用时 X」），
// 侧栏也不会跟着 `added` / `removed` 更新——而两边都不会报错。
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForwardedEventsBridge } from "../api-gateway/forwarded-events.service.ts";

/** 一条装配跑两条：两条都只读同一张频道表（互不写状态）。 */
let app: App;

beforeAll(async () => {
  app = await bootstrapApplication({
    providers: [RemoteHandlersDefault, ForwardedEventsBridge],
    timeoutMs: 20_000,
  });
});

afterAll(async () => {
  await app.dispose().catch(() => {});
});

/**
 * 宿主 emit 一帧（事件名来自 vendor 的表，`Events` 的强类型增强不在我们的 program 里，这里按名字发）。
 * @param event - cordis 事件名。
 * @param args - 载荷。
 */
function emit(event: string, ...args: unknown[]): void {
  (app.ctx as unknown as { emit(name: string, ...payload: unknown[]): void }).emit(event, ...args);
}

describe("转发事件桥", { timeout: 20_000 }, () => {
  it("宿主 emit 的 `api-session/status` 会进频道（浏览器侧的 running 靠它）", () => {
    const handlers = app.get(RemoteHandlers);
    const frames: unknown[][] = [];
    handlers.subscribe("api-session/status", (...args) => {
      frames.push(args as unknown[]);
    });

    emit("api-session/status", "s1", true);
    expect(frames).toEqual([["s1", true]]);
  });

  it("`api-session/added` 与 `removed` 也在表里（侧栏的增删靠它们）", () => {
    const handlers = app.get(RemoteHandlers);
    const added: unknown[][] = [];
    const removed: unknown[][] = [];
    handlers.subscribe("api-session/added", (...args) => {
      added.push(args as unknown[]);
    });
    handlers.subscribe("api-session/removed", (...args) => {
      removed.push(args as unknown[]);
    });

    emit("api-session/added", { sessionId: "s1" });
    emit("api-session/removed", "s1");
    expect(added).toEqual([[{ sessionId: "s1" }]]);
    expect(removed).toEqual([["s1"]]);
  });
});
