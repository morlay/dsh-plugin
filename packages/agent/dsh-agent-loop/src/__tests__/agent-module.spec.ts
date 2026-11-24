/**
 * 装配冒烟：`provideAgent` 的一组 provider 能起来，端口也能取到。
 *
 * 只做「装配成功 + 令牌可用」这一层；跑循环的用例在 `agent-loop.spec.ts`。
 */
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { bootstrapApplication } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { describe, expect, test } from "@morlay/zephyr-app/testing";
import { AgentDirectory, Llm, SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent";

describe("provideAgent", () => {
  test(
    "装配后 AgentDirectory / Llm / ToolRegistry / SystemPrompt 都能解析（headless 层）",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const app = await bootstrapApplication({
        providers: [
          ...provideSession(),
          ...provideSessionProjection(),
          { provide: AppEnv, useValue: appEnv },
          RemoteHandlersDefault,
          ...provideAgent(),
        ],
      } as never);
      try {
        expect(app.get(AgentDirectory)).toBeDefined();
        expect(app.get(Llm)).toBeDefined();
        expect(app.get(ToolRegistry)).toBeDefined();
        expect(app.get(SystemPrompt)).toBeDefined();
      } finally {
        await app.dispose();
      }
    },
  );
});
