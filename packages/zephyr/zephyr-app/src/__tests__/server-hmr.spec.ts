// 服务端 HMR 的调度语义：**忙就不换树，空闲才换**。
//
// 这条钉的是"等空闲"本身：有在途调用时重载，那条请求会拿到半新半旧的对象图。
import { ServerHmr } from "../internal/server-hmr.ts";
import { describe, expect, it, vi } from "vitest";

/** 调度器的轮询周期：等待"该发生的发生了 / 不该发生的没发生"都按它的倍数算，不写死毫秒。 */
const POLL_MS = 5;

/** 造一个只带 `inFlight` 的 MuxServer 替身。 */
function hmrWith(inFlight: () => number): ServerHmr {
  const hmr = new ServerHmr();
  Object.assign(hmr as unknown as Record<string, unknown>, {
    mux: { inFlight },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  return hmr;
}

/** 等若干毫秒。 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等重载被调用到指定次数（轮询间隔与调度器同频，别用 vitest 默认的 50ms 白等）。 */
async function reloadedTimes(reload: unknown, times: number): Promise<void> {
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(times), {
    timeout: 1000,
    interval: POLL_MS,
  });
}

describe("ServerHmr", () => {
  it("空闲时立刻重载", async () => {
    const reload = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 0);
    hmr.install({ reload, pollMs: POLL_MS });
    hmr.notify("a.ts");
    await reloadedTimes(reload, 1);
  });

  it("有在途调用时等着，空了才换树", async () => {
    let busy = 2;
    const reload = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => busy);
    hmr.install({ reload, pollMs: POLL_MS });
    hmr.notify("a.ts");
    await wait(POLL_MS * 4);
    expect(reload, "忙的时候不许换树").not.toHaveBeenCalled();
    busy = 0;
    await reloadedTimes(reload, 1);
  });

  it("业务层说忙也要等（`isIdle`）", async () => {
    const reload = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 0);
    let idle = false;
    hmr.install({ reload, pollMs: POLL_MS, isIdle: () => idle });
    hmr.notify("a.ts");
    await wait(POLL_MS * 4);
    expect(reload, "agent 还在跑时不许换树").not.toHaveBeenCalled();
    idle = true;
    await reloadedTimes(reload, 1);
  });

  it("等空闲期间多次变化合并成一次重载", async () => {
    let busy = 1;
    const reload = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => busy);
    hmr.install({ reload, pollMs: POLL_MS });
    hmr.notify("a.ts");
    hmr.notify("b.ts");
    hmr.notify("c.ts");
    busy = 0;
    await reloadedTimes(reload, 1);
    await wait(POLL_MS * 4);
    expect(reload, "三次变化只换一次树").toHaveBeenCalledTimes(1);
  });

  it("等太久也重载（超时兜底：改动不能永远不生效）", async () => {
    const reload = vi.fn(async (_files: readonly string[]) => {});
    const hmr = hmrWith(() => 1);
    hmr.install({ reload, pollMs: POLL_MS, maxWaitMs: 20 });
    hmr.notify("a.ts");
    await reloadedTimes(reload, 1);
  });

  it("重载期间又变了：那批会再排一轮，不会丢", async () => {
    const seen: string[][] = [];
    let release: (() => void) | undefined;
    const reload = vi.fn(async (files: readonly string[]) => {
      seen.push([...files]);
      // 第一次重载故意不结束，模拟"换树要花时间"。
      if (seen.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    const hmr = hmrWith(() => 0);
    hmr.install({ reload, pollMs: POLL_MS });
    hmr.notify("a.ts");
    await reloadedTimes(reload, 1);
    // 上一轮还没结束，这期间来的变化必须攒着。
    hmr.notify("b.ts");
    release?.();
    await reloadedTimes(reload, 2);
    expect(seen, "第二批只含新增的那个文件").toEqual([["a.ts"], ["b.ts"]]);
  });
});
