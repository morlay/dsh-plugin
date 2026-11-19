// 服务端 HMR 的调度语义：**忙就不换树，空闲才换**。
//
// 这条钉的是"等空闲"本身：有在途调用时重载，那条请求会拿到半新半旧的对象图。
// 第二条轴是**契约形态**：`ServerHmr` 是 `DevHmr` 的实现，`install` 之后 `notify` 要能调到
// hooks 里的 `restart`，并且变更来源走 `ClientAssets.onServerSourceChange`（不在这里重复桥一遍）。
// 第三条轴是**忙碌判据的来源**：域登记的 `IdleGuard` 说忙就等（装配面不交这份知识）。
import { ServerHmr } from "../internal/server-hmr.ts";
import { provideServerHmr } from "../dev-hmr/provide.ts";
import { ClientAssets, DevHmr } from "@morlay/zephyr-app";
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, it, vi } from "vitest";

/** 调度器的轮询周期：等待"该发生的发生了 / 不该发生的没发生"都按它的倍数算，不写死毫秒。 */
const POLL_MS = 5;

/** 造一个只带 `inFlight` 的 MuxServer 替身（外加一个不报变更的 `ClientAssets`）。 */
function hmrWith(inFlight: () => number): ServerHmr {
  const hmr = new ServerHmr({ pollMs: POLL_MS });
  Object.assign(hmr, {
    mux: { inFlight },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    clientAssets: { onServerSourceChange: () => () => {} },
    // 各域的忙碌判据：本文件在需要时自己塞实现（默认一条都没有 = 空闲）。
    guards: [],
  });
  return hmr;
}

/** 造一个只报"某处变了"的 `ClientAssets` 替身：订阅者由用例自己触发。 */
function assetsThatReport(): { assets: ClientAssets; fire: (file: string) => void } {
  const listeners = new Set<(file: string) => void>();
  const assets = Object.assign(Object.create(ClientAssets.prototype) as ClientAssets, {
    onServerSourceChange: (listener: (file: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    assets,
    fire: (file) => {
      for (const listener of listeners) listener(file);
    },
  };
}

/** 等若干毫秒。 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等重载被调用到指定次数（轮询间隔与调度器同频，别用 vitest 默认的 50ms 白等）。 */
async function restartedTimes(restart: unknown, times: number): Promise<void> {
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(times), {
    timeout: 1000,
    interval: POLL_MS,
  });
}

describe("ServerHmr", () => {
  it("契约形态：`ServerHmr` 就是 `DevHmr`，`install` 后 `notify` 调到 `restart`", async () => {
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 0);
    expect(hmr, "`ServerHmr` 必须是 `DevHmr` 的实现").toBeInstanceOf(DevHmr);
    // 只经契约面调用：消费方（应用装配）看到的就是这两条。
    const devHmr: DevHmr = hmr;
    devHmr.install({ restart });
    hmr.notify("a.ts");
    await restartedTimes(restart, 1);
    expect(restart.mock.calls[0]?.[0], "`restart` 拿到这一轮变化").toEqual(["a.ts"]);
  });

  it("变更来源走 `ClientAssets`：订阅来的变化等于 `notify`（且遵守空闲判据）", async () => {
    let busy = 1;
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => busy);
    const { assets, fire } = assetsThatReport();
    Object.assign(hmr, { clientAssets: assets });
    hmr.install({ restart });
    fire("b.ts");
    await wait(POLL_MS * 4);
    expect(restart, "忙的时候不许换树").not.toHaveBeenCalled();
    busy = 0;
    await restartedTimes(restart, 1);
    expect(restart.mock.calls[0]?.[0]).toEqual(["b.ts"]);
    // 撤销后不再报：订阅面真的被收掉了。
    hmr.onDispose();
    fire("c.ts");
    await wait(POLL_MS * 4);
    expect(restart, "撤销之后的变更不再触发重载").toHaveBeenCalledTimes(1);
  });

  it("空闲时立刻重载", async () => {
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 0);
    hmr.install({ restart });
    hmr.notify("a.ts");
    await restartedTimes(restart, 1);
  });

  it("有在途调用时等着，空了才换树", async () => {
    let busy = 2;
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => busy);
    hmr.install({ restart });
    hmr.notify("a.ts");
    await wait(POLL_MS * 4);
    expect(restart, "忙的时候不许换树").not.toHaveBeenCalled();
    busy = 0;
    await restartedTimes(restart, 1);
  });

  it("域登记的 `IdleGuard` 说忙也要等", async () => {
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 0);
    let idle = false;
    Object.assign(hmr, { guards: [{ isIdle: () => idle }] });
    hmr.install({ restart });
    hmr.notify("a.ts");
    await wait(POLL_MS * 4);
    expect(restart, "agent 还在跑时不许换树").not.toHaveBeenCalled();
    idle = true;
    await restartedTimes(restart, 1);
  });

  it("等空闲期间多次变化合并成一次重载", async () => {
    let busy = 1;
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => busy);
    hmr.install({ restart });
    hmr.notify("a.ts");
    hmr.notify("b.ts");
    hmr.notify("c.ts");
    busy = 0;
    await restartedTimes(restart, 1);
    await wait(POLL_MS * 4);
    expect(restart, "三次变化只换一次树").toHaveBeenCalledTimes(1);
  });

  it("等太久也重载（超时兜底：改动不能永远不生效）", async () => {
    const restart = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 1);
    Object.assign(hmr, {
      options: { pollMs: POLL_MS, maxWaitMs: 20 },
    });
    hmr.install({ restart });
    hmr.notify("a.ts");
    await restartedTimes(restart, 1);
  });

  it(
    "装配面不装 MuxServer 时换树行照样装得上，按各域 IdleGuard 判空闲",
    { timeout: 5_000 },
    async () => {
      // 应用清单的 wire 载体交回上游之后不再装 MuxServer：传输层那条判据跟着消失，
      // 剩下的空闲判据是各域登记的 IdleGuard。
      const app = await bootstrapApplication({
        providers: [...provideServerHmr()],
        timeoutMs: 5_000,
      });
      try {
        const restart = vi.fn(async (_files: readonly string[]) => {});
        // 换树行就是 `DevHmr` 的实现（同一个令牌）：`notify` 只在实现上，走它触发这一轮。
        const hmr = app.get(ServerHmr);
        expect(app.get(DevHmr), "`DevHmr` 必须解析到那一行").toBe(hmr);
        hmr.install({ restart });
        hmr.notify("a.ts");
        await restartedTimes(restart, 1);
        expect(restart.mock.calls[0]?.[0]).toEqual(["a.ts"]);
      } finally {
        await app.dispose();
      }
    },
  );

  it("重载期间又变了：那批会再排一轮，不会丢", async () => {
    const seen: string[][] = [];
    let release: (() => void) | undefined;
    const restart = vi.fn(async (files: readonly string[]) => {
      seen.push([...files]);
      // 第一次重载故意不结束，模拟"换树要花时间"。
      if (seen.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    const hmr = hmrWith(() => 0);
    hmr.install({ restart });
    hmr.notify("a.ts");
    await restartedTimes(restart, 1);
    // 上一轮还没结束，这期间来的变化必须攒着。
    hmr.notify("b.ts");
    release?.();
    await restartedTimes(restart, 2);
    expect(seen, "第二批只含新增的那个文件").toEqual([["a.ts"], ["b.ts"]]);
  });
});
