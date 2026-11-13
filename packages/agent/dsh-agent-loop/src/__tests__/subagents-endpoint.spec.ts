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
import { FsSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { provideAgent, WorkingDirectoryDefault } from "@morlay/dsh-agent";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { RemoteHandlers, provideApiGateway, provideTypert } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { AgentLoopDefault, ToolExecutorNative } from "../index.ts";
import { provideSubagentEndpoints } from "../server/index.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 起带 `remote.subagents` 的真栈（沙箱根用进程 cwd：这几条用例不落盘）。 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSessionProjection(),
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      ...provideApiGateway(),

      SessionStoreDefault,
      ...provideAgent(),
      // 循环期：要真 agent 工厂。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      {
        provide: SandboxPolicyDefault,
        config: { mode: "workspace-write", workspaceRoot: process.cwd() },
      },
      FsSandbox,
      WorkingDirectoryDefault,
      ...provideSubagentEndpoints(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("subagents/* 的宿主面", { timeout: 30_000 }, () => {
  it("interruptByUser 对没有活子代理的地址是接受的 no-op（回回执，不抛）", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("subagents/interruptByUser", {
      childSessionId: SessionId("child-none"),
    });
    expect(result).toMatchObject({ ok: true });
    // 回执形状（上游 `SubagentInterruptReceipt`：是否受理了这次取消信号）。
    expect(JSON.stringify(result)).toContain("accepted");
  });

  it("空的子会话地址由上游拒绝（`gateway/bad-request`，不是静默成功）", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("subagents/interruptByUser", {
      childSessionId: "",
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error?: { code?: string } }).error?.code).toBe("gateway/bad-request");
  });

  it("prompt 在没有 provider 的装配里由上游报错，而不是「没实现」", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("subagents/prompt", {
      request: { sessionId: SessionId("s1"), prompt: "hi", provider: "missing" },
    });
    expect(result).toMatchObject({ ok: false });
    const message = (result as { error?: { message?: string } }).error?.message ?? "";
    expect(message).not.toContain("没有实现");
  });
});
