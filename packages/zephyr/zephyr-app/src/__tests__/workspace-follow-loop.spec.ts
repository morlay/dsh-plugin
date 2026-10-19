// workspace 的流式链路（纯 node）：`workspace/follow` 的帧从 host 经真 WebSocket 到达客户端。
//
// 这条缝的两端：host 侧 `RemoteHandlers.registerStream`（谁来产帧），客户端 `remote.workspace.follow`
// （descriptor 里 `mode: 'stream'` 的方法要返回逐帧迭代面，而不是 unary 的单个值）。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { TYPERT_REMOTE as WORKSPACE_REMOTE } from "@deepseek-ai/dsh-api-workspace-controller/remote";
import { afterEach, describe, expect, it } from "vitest";
import { Remote, provideClientRemote, ClientConnectionDefault, provideClientConnection, muxTransport } from "@morlay/zephyr-app/client";
import { closeMux, serveMux } from "./support/mux-serve.ts";

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
}, 5_000);

describe("workspace follow 流（纯 node：真 WebSocket）", { timeout: 15_000 }, () => {
  it("host 逐帧发出的 baseline 能到达客户端，abort 后两端都结束", async () => {
    const { url, handlers, server } = await serveMux();
    closers.push(async () => await closeMux(server));

    let hostAborted = false;
    handlers.registerStream("workspace/follow", async function* (_args, signal) {
      yield { type: "baseline", value: { items: [{ workspaceId: "w1" }] } };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          hostAborted = true;
          resolve();
        }, { once: true });
      });
    });

    const app = await bootstrapApplication({
      providers: [
        ...provideClientConnection(),
        ...provideClientRemote(),
        ...configure(ClientConnectionDefault, {
          origin: `http://127.0.0.1:${String(new URL(url).port)}`,
        })([ClientConnectionDefault]),
      ],
      timeoutMs: 15_000,
    });
    try {
      const remote = app.get(Remote) as unknown as {
        $mount(c: unknown): Promise<() => Promise<void>>;
        useTransport(t: unknown): void;
        workspace?: { follow(signal?: AbortSignal): AsyncIterable<unknown> };
      };
      remote.useTransport(
        muxTransport(() => ({ openWebSocket: (path: string) => new WebSocket(`${url}${path}`) }) as never),
      );
      await remote.$mount(WORKSPACE_REMOTE);

      const controller = new AbortController();
      const source = remote.workspace?.follow(controller.signal);
      expect(source, "descriptor 里 workspace/follow 是流式方法，面必须存在").toBeDefined();

      const received: unknown[] = [];
      const reader = (async (): Promise<void> => {
        for await (const frame of source as AsyncIterable<unknown>) received.push(frame);
      })();
      // 等第一帧到达（轮询而不是猜时长）。
      for (let waited = 0; received.length === 0 && waited < 2_000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(received[0]).toEqual({ type: "baseline", value: { items: [{ workspaceId: "w1" }] } });

      controller.abort();
      await reader;
      // `cancel` 帧要经 socket 到 host：等它落地，别用一个固定 sleep 猜。
      for (let waited = 0; !hostAborted && waited < 2_000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(hostAborted).toBe(true);
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
