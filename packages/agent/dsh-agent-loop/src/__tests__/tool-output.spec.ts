// tool-output 域的局部闭环：真 `LocalSpillStore` + 真 `ToolRegistry` / `TokenMeter`（落盘根用上游默认：
// 进程私有的临时目录，本用例不额外指定）。
//
// 断言落在这一组唯一有返回值的行为上：`saveText` 真的把正文落成文件，并给出字节数与定位串。
// 其余两行（落盘策略、结果裁剪）没有自己的契约面，装得上、依赖满足即为它们的判据。
import { SpillLocal } from "@morlay/dsh-agent-loop";
import { SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent";
import { SessionStore, SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection, provideTokenMeter } from "@morlay/dsh-session/server";
import { provideToolOutput } from "../server/tool-output.provide.ts";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";

async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSessionProjection(),
      ...provideTokenMeter(),

      SystemPromptDefault,
      ToolRegistryDefault,
      SessionStoreDefault,
      ...provideToolOutput(),
    ],
    timeoutMs: 20_000,
  });
  return app;
}

describe("tool-output 域", () => {
  test("落盘行把正文写成文件，并给出字节数与定位串", { timeout: 20_000 }, async () => {
    const app = await boot();
    try {
      // 令牌是**行**（`SpillLocal`）：上游类只是它包装的实现，不再是令牌。
      const spill = app.get(SpillLocal);

      // 会话身份由真存储铸出来（本包不依赖 `@deepseek-ai/dsh-session` 的品牌工厂）。
      const session = app.get(SessionStore).create();
      const ref = await spill.saveText({
        owner: { sessionId: session.id },
        source: { kind: "session-reference", sessionId: session.id, label: "result" },
        suggestedName: "demo.txt",
        content: "长输出的正文",
      });

      expect(ref.bytes).toBe(new TextEncoder().encode("长输出的正文").byteLength);
      expect(ref.locator).toContain("demo");
      expect(ref.retrievalHint.length).toBeGreaterThan(0);
    } finally {
      // 收尾放在测试体里而不是 `onTestFinished`：`dispose` 要等上游 spill / registry 的在途写盘收尾，
      // 并行构建机上会超过 vitest 默认的 10s `hookTimeout`（钩子超时没有 per-call 的 timeout 可给，
      // `onTestFinished` 也不支持）。放进测试体后按本用例的 `testTimeout`（上面 20s）计，
      // 且断言失败时 `finally` 照样释放装配。
      await app.dispose();
    }
  });
});
