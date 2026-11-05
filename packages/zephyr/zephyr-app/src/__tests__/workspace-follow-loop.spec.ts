// workspace 的流式链路（纯 node）：descriptor 里 `mode: 'stream'` 的方法要返回逐帧迭代面，
// 且 `abort` 要透传到传输层。**假 transport** 就够：真 wire 的帧形状由 `mux-seam.spec` 守着。
//
// 这是 `Remote` 面（descriptor 的流式语义）在包内的**必要闭环**，不属于 apps 的整装组合：
// 它读的是本包的 descriptor / transport 接缝，与业务行装没装无关。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { TYPERT_REMOTE as WORKSPACE_REMOTE } from "@deepseek-ai/dsh-api-workspace-controller/remote";
import { describe, expect, it } from "vitest";
import {
  Remote,
  ClientConnectionDefault,
  mockTransport,
  provideClientConnection,
  provideClientRemote,
} from "@morlay/zephyr-app/client";
import { within } from "./support/within.ts";

describe("workspace follow 流（假 transport）", { timeout: 15_000 }, () => {
  it("descriptor 的流式面逐帧产出，abort 透传到传输层", async () => {
    let hostAborted = false;
    const transport = mockTransport(
      {},
      {
        "workspace/follow": (_payload, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              hostAborted = true;
            },
            { once: true },
          );
          return (async function* () {
            yield { type: "baseline", value: { items: [{ workspaceId: "w1" }] } };
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
          })();
        },
      },
    );

    const app = await bootstrapApplication({
      providers: [
        ...provideClientConnection(
          configure(ClientConnectionDefault, { origin: "http://127.0.0.1:1" }),
        ),
        ...provideClientRemote(),
      ],
      timeoutMs: 15_000,
    });
    try {
      const remote = app.get(Remote) as unknown as {
        $mount(c: unknown): Promise<() => Promise<void>>;
        useTransport(t: unknown): void;
        workspace?: { follow(signal?: AbortSignal): AsyncIterable<unknown> };
      };
      remote.useTransport(transport);
      await remote.$mount(WORKSPACE_REMOTE);

      const controller = new AbortController();
      const source = remote.workspace?.follow(controller.signal);
      expect(source, "descriptor 里 workspace/follow 是流式方法，面必须存在").toBeDefined();

      // 等第一帧真的到（信号而不是猜时长）。
      const received: unknown[] = [];
      let onFrame: (() => void) | undefined;
      const firstFrame = new Promise<void>((resolve) => {
        onFrame = resolve;
      });
      const reader = (async (): Promise<void> => {
        for await (const frame of source as AsyncIterable<unknown>) {
          received.push(frame);
          onFrame?.();
        }
      })();
      await within(firstFrame, 1_000, "workspace/follow 的第一帧到达客户端");
      expect(received[0]).toEqual({ type: "baseline", value: { items: [{ workspaceId: "w1" }] } });

      controller.abort();
      await reader;
      await within(
        (async () => {
          while (!hostAborted) await new Promise((resolve) => setTimeout(resolve, 0));
        })(),
        1_000,
        "abort 透传到传输层",
      );
      expect(hostAborted, "abort 没透传，宿主那条流就会永远挂着").toBe(true);
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
