// @vitest-environment happy-dom
/**
 * **流式端点走 stream 载具**：`session/control` 端到端能开出帧。
 *
 * 这条钉的是真实链路（真 `MuxServer` + 真 `Connection` + 真 gateway）：流式端点若落到
 * unary 的 `invoke` 上，上游会拒 `stream Remote methods must be opened through the stream carrier`。
 */
import { configure, bootstrapApplication, type App } from "@morlay/zephyr";
import { clientPackagesOf, WebServer } from "@morlay/zephyr-app";
import { ClientConnectionDefault, Remote, SessionRemoteBinding } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { appClientProviders } from "../index.ts";
import { customProvidersOf } from "../../zephyr.provide.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0).reverse()) {
    await Promise.race([
      app.dispose().catch(() => {}),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10_000);
      }),
    ]);
  }
}, 120_000);

describe("流式端点", { timeout: 240_000 }, () => {
  it("`session/control` 能开出帧，不报「must be opened through the stream carrier」", async () => {
    process.env.PORT = "0";
    const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
    const backend = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
    opened.push(backend);
    const port = (backend.get(WebServer) as { port?: number }).port;

    const frontend = await bootstrapApplication({
      providers: [
        ...appClientProviders(configure(ClientConnectionDefault, { origin: `http://127.0.0.1:${port}` })),
      ],
      timeoutMs: 90_000,
    });
    opened.push(frontend);

    const remote = frontend.get(Remote) as unknown as { session: { control(signal: AbortSignal): AsyncIterable<unknown> } };
    const controller = new AbortController();
    const frames: unknown[] = [];
    // 只取首帧就够：能开出第一帧就说明载具对了；报错会在这里抛出。
    const timer = setTimeout(() => controller.abort(new Error("timeout")), 20_000);
    try {
      for await (const frame of remote.session.control(controller.signal)) {
        frames.push(frame);
        break;
      }
    } finally {
      clearTimeout(timer);
      controller.abort(new Error("done"));
    }
    expect(frames.length, "`session/control` 必须能开出至少一帧").toBeGreaterThan(0);
  });

  it("客户端把 `mode: 'stream'` 的端点记成流式（不是 unary）", async () => {
    process.env.PORT = "0";
    const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
    const backend = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
    opened.push(backend);
    const port = (backend.get(WebServer) as { port?: number }).port;

    const frontend = await bootstrapApplication({
      providers: [
        ...appClientProviders(configure(ClientConnectionDefault, { origin: `http://127.0.0.1:${port}` })),
      ],
      timeoutMs: 90_000,
    });
    opened.push(frontend);

    // 绑定行负责 `$mount` descriptor；没装它，`streams` 就是空的，`control` 会被当成 unary。
    expect(frontend.get(SessionRemoteBinding), "SessionRemoteBinding 必须装上").toBeDefined();
    const remote = frontend.get(Remote) as { session: { control?: unknown } };
    expect(typeof remote.session.control, "`control` 必须是一个可调用的流式面").toBe("function");
  });
});
