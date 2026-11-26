// `subagents/*` 的宿主面：真上游 `SubagentRuntime`（`SubagentRegistryDefault` 接管的那个实例）+ 两条端点。
//
// 判据落在上游自己的行为上：
// - `interruptByUser` 对「没有活的子代理」的地址是**接受的 no-op**（上游注释：absent / idle /
//   already-completed 都在那里被接受）→ `{ ok: true }` 且回执形状正确；
// - 空 id 由上游 `validateControlRequest` 拒（`gateway/bad-request`，不是静默成功）；
// - `prompt` 在没有任何 provider 注册的装配里由上游报错（不是「没实现」）。
//
// 这两条端点归本包（`server/subagents-endpoint.ts` 是它们的宿主实现），所以 spec 也住这里：
// 依赖方向是 agent-loop → sandbox（生产边），反向不成立。
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { FsSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { provideAgent, WorkingDirectoryDefault } from "@morlay/dsh-agent";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, provideApiGateway, provideTypert } from "@morlay/zephyr-app";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { AgentLoopDefault, ToolExecutorNative } from "../index.ts";
import { provideSubagentEndpoints } from "../server/index.ts";

/** 起始目录与沙箱兜底根的来源（环境事实只有一个来源：不读进程 cwd）。 */
const ROOT = "/dsh-subagents-endpoint";

/** 起带 `remote.subagents` 的真栈（沙箱根用固定目录：这几条用例不落盘）。 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSessionProjection(),
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      ...provideApiGateway(),

      SessionStoreDefault,
      { provide: AppEnv, useValue: createTestingAppEnv({ root: ROOT }) },
      ...provideAgent(),
      // 循环期：要真 agent 工厂。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      { provide: SandboxPolicyDefault, config: { mode: "workspace-write", workspaceRoot: ROOT } },
      FsSandbox,
      WorkingDirectoryDefault,
      ...provideSubagentEndpoints(),
    ],
    timeoutMs: 20_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return app;
}

describe("subagents/* 的宿主面", { timeout: 30_000 }, () => {
  // 三条判据都是**裸值口径**：宿主回裸值（`RemoteResult` 归桥/客户端面），失败是**抛异常**。
  // 包过一层的话第 1 条会拿到 `{ ok: true, value: { accepted: true } }`，第 2/3 条不会抛。
  test("interruptByUser 对没有活子代理的地址是接受的 no-op（回回执，不抛）", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("subagents/interruptByUser", {
      childSessionId: SessionId("child-none"),
    });
    expect(result).not.toHaveProperty("ok");
    // 回执形状（上游 `SubagentInterruptReceipt`：是否受理了这次取消信号）。
    expect(result).toEqual({ accepted: true });
  });

  test("空的子会话地址由上游拒绝（抛 `RemoteError`，不是静默成功）", async () => {
    const app = await boot();
    await expect(app.get(RemoteHandlers).invoke("subagents/interruptByUser", { childSessionId: "" })).rejects.toThrow(
      /invalid payload/,
    );
  });

  test("prompt 在没有 provider 的装配里由上游报错，而不是「没实现」", async () => {
    const app = await boot();
    const error = await app
      .get(RemoteHandlers)
      .invoke("subagents/prompt", {
        request: { sessionId: SessionId("s1"), prompt: "hi", provider: "missing" },
      })
      .then(
        () => new Error("应当抛错"),
        (thrown: unknown) => thrown,
      );
    expect(error).not.toHaveProperty("ok");
    const message = (error as Error).message ?? "";
    expect(message).not.toContain("没有实现");
  });
});