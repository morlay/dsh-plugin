// tool-output 域的局部闭环：真 `LocalSpillStore` + 真 `ToolRegistry` / `TokenMeter`（落盘根用上游默认：
// 进程私有的临时目录，本用例不额外指定）。
//
// 断言落在这一组唯一有返回值的行为上：`saveText` 真的把正文落成文件，并给出字节数与定位串。
// 其余两行（落盘策略、结果裁剪）没有自己的契约面，装得上、依赖满足即为它们的判据。
import { LocalSpillStore } from "@deepseek-ai/dsh-spill-local";
import { SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent/server";
import { SessionStore, SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection, provideTokenMeter } from "@morlay/dsh-session/server";
import { provideToolOutput } from "@morlay/dsh-tool-output";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [...provideSessionProjection(), ...provideTokenMeter(),
    
      SystemPromptDefault,
      ToolRegistryDefault,
      SessionStoreDefault,
      ...provideToolOutput(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("tool-output 域", () => {
  it("落盘行把正文写成文件，并给出字节数与定位串", { timeout: 20_000 }, async () => {
    const app = await boot();
    const spill = app.get(LocalSpillStore);

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
  });
});
