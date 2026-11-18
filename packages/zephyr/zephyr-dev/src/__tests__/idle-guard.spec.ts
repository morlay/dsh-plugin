// `IdleGuard` 的跨包证据：**实现由各域装、消费在开发运行时的 `ServerHmr`**。
//
// 本包不声明 `IdleGuard`（契约在 `@morlay/zephyr-app`），所以这条用例走真装配：
// 装一条实现，断言 `ServerHmr` 通过 `inject.all` 收到它，并在它说忙时把换树按住。
import { bootstrapApplication, Injectable, stub } from "@morlay/zephyr";
import { IdleGuard, MuxServer } from "@morlay/zephyr-app";
import { describe, expect, it, vi } from "vitest";
import { ServerHmr } from "../internal/server-hmr.ts";

/** 调度器的轮询周期（与 `server-hmr.spec.ts` 同频）。 */
const POLL_MS = 5;

/** 一条由「某个域」登记的空闲判据。 */
@Injectable({ multi: true })
class FakeGuard extends IdleGuard {
  /** 这个域现在忙不忙（用例直接改它）。 */
  busy = false;

  /**
   * @returns 不忙就是空闲。
   */
  isIdle(): boolean {
    return !this.busy;
  }
}

/** 传输层替身：没有在途调用。 */
const MUX = { provide: MuxServer, useValue: stub(MuxServer, { inFlight: () => 0 }) };

describe("IdleGuard 的装配面", () => {
  it("域登记的那条被 `ServerHmr` 收下：它说忙就不换树", async () => {
    const app = await bootstrapApplication({
      providers: [FakeGuard, ServerHmr, MUX],
    });
    try {
      const hmr = app.get(ServerHmr);
      const [guard] = app.getAll(IdleGuard);
      if (!(guard instanceof FakeGuard)) {
        throw new Error("`IdleGuard` 没收到域登记的那条实现");
      }
      guard.busy = true;
      const restart = vi.fn(async (_files: readonly string[]) => {});
      hmr.install({ restart });
      hmr.notify("a.ts");
      await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
      expect(restart, "域说忙时不许换树").not.toHaveBeenCalled();
      guard.busy = false;
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), {
        timeout: 1000,
        interval: POLL_MS,
      });
    } finally {
      await app.dispose();
    }
  });
});
