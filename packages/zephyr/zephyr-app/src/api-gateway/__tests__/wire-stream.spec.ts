// mux 的 **流式面全流程**：真宿主、真 WebSocket、真客户端 transport。
//
// 流式方法（`workspace/follow`、终端的 `terminal/attach`）与 unary 走两条不同的载具：unary 是 HTTP，
// 流式只认 `/api/remote.mux` 上的 `open`/`item`/`end`/`cancel` 帧。接错一端，界面表现是
// 「工作区列表空」「终端能看不能输入」——都在离原因很远的地方。
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebServer } from "../../web/web-server.contract.ts";
import { RemoteHandlers } from "../remote-handlers.contract.ts";
import { mountWireApp, type WireApp } from "../../__tests__/support/wire-app.ts";

const opened: WireApp[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose();
}, 30_000);

/** 起一份真宿主并在用例后拆掉。 */
async function boot(): Promise<WireApp> {
  const app = await mountWireApp();
  opened.push(app);
  return app;
}

describe("mux 的流式面（真宿主 + 真 WebSocket）", { timeout: 20_000 }, () => {
  // 这条曾经是红的：宿主上两份 `/api/remote.mux` 的 upgrade 注册并存，先注册的上游那份赢，
  // 而它只认 typert 注册表——自研 `registerStream` 的端点在真机上没有 wire 入口。
  // 现在 upgrade 只注册一条（自研接管），协议实现仍是上游的 `RemoteStreamMuxServer`，
  // 分派点先查自研路由表、再回落上游 gateway。
  it("自研路由表注册的流式方法：宿主逐帧产出的值能到客户端", async () => {
    const host = await boot();
    host.app
      .get(RemoteHandlers)
      .registerStream("workspace/follow", async function* (_args, signal) {
        yield { type: "baseline", entries: [] };
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      });

    const controller = new AbortController();
    const stream = host.client().openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "baseline", entries: [] },
      done: false,
    });
    await iterator.return?.(undefined);
  });

  it("/api/remote.mux 只有一条 upgrade 注册（上游 api-gateway 不再装它自己那份）", async () => {
    const host = await boot();
    const upgrades = host.app
      .get(WebServer)
      .routesOf()
      .filter((route) => route.kind === "upgrade" && route.path === "/api/remote.mux");
    expect(upgrades.length, "两份并存时先注册的上游那份赢，自研分流就永远接不到连接").toBe(1);
  });

  it("客户端结束迭代时宿主那条流要收尾（补发 cancel，否则宿主永远不结）", async () => {
    const host = await boot();
    let hostAborted = false;
    host.app
      .get(RemoteHandlers)
      .registerStream("workspace/follow", async function* (_args, signal) {
        yield { type: "baseline" };
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              hostAborted = true;
              resolve();
            },
            { once: true },
          );
        });
      });

    const controller = new AbortController();
    const stream = host.client().openStream("workspace/follow", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "baseline" } });
    // 迭代被 `return()`（上游 `RemoteStream.dispose()` 就是这么收尾的）时客户端补发 cancel。
    await iterator.return?.(undefined);
    await vi.waitFor(() => expect(hostAborted, "宿主那条流的取消信号要真的被 abort").toBe(true), {
      timeout: 5_000,
    });
  });

  it("双向流：客户端 `send` 的项到宿主的上行迭代，`end` 半关", async () => {
    const host = await boot();
    const received: unknown[] = [];
    let uplinkEnded = false;
    host.app
      .get(RemoteHandlers)
      .registerStream("terminal/attach", async function* (_args, signal, uplink) {
        void (async () => {
          for await (const item of uplink) received.push(item);
          uplinkEnded = true;
        })();
        yield { type: "ready" };
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      });

    const controller = new AbortController();
    const stream = host.client().openStream("terminal/attach", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "ready" } });
    stream.send({ type: "write", sequence: 1, data: "hi" });
    stream.end();

    await vi.waitFor(() => expect(received).toEqual([{ type: "write", sequence: 1, data: "hi" }]), {
      timeout: 5_000,
    });
    await vi.waitFor(() => expect(uplinkEnded, "end 半关之后上行迭代结束").toBe(true), {
      timeout: 5_000,
    });
    await iterator.return?.(undefined);
  });

  it("端点不存在：客户端立刻拿到流失败，不会挂住", async () => {
    const host = await boot();
    const controller = new AbortController();
    const stream = host.client().openStream("nobody/follows", { args: {} }, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(/no active Remote method exports/u);
  });
});
