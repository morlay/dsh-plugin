// compaction 域的局部闭环：真 `BasicCompactionEngine` + 真 `Llm` / `TokenMeter` / `SessionStore`，
// 不假本包服务，也不碰模型调用（只装配与契约面）。
//
// 断言是「引擎真的接管了令牌」与「契约声明的两个入口都在」：压缩本身要活会话与真实模型往返，
// 那是运行期行为，不是装配面能守的。
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { provideAgent } from "@morlay/dsh-agent";
import { Compaction, provideCompactionBasic } from "../index.ts";
import {
  provideSession,
  provideSessionProjection,
  provideTokenMeter,
} from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideTokenMeter(),
      ...provideAgent(),
      ...provideCompactionBasic(),
    ],
    timeoutMs: 20_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return app;
}

describe("compaction 域", () => {
  test(
    "`provideCompactionBasic` 装的是上游引擎，`Compaction` 令牌解析到它",
    { timeout: 20_000 },
    async () => {
      const app = await boot();
      expect(app.get(Compaction)).toBeInstanceOf(BasicCompactionEngine);
    },
  );

  test("契约声明的两个入口都在（自动压缩 / 手动压缩）", { timeout: 20_000 }, async () => {
    const app = await boot();
    const engine = app.get(Compaction);
    expect(typeof engine.compactIfNeeded).toBe("function");
    expect(typeof engine.compactNow).toBe("function");
  });
});
