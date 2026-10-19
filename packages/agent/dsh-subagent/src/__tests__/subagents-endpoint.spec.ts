// `subagents/*` 的宿主面：真上游 `SubagentRuntime`（`SubagentRegistryDefault` 接管的那个实例）+ 两条端点。
//
// 判据落在上游自己的行为上：
// - `interruptByParent` 对「没有活的子代理」的地址是**接受的 no-op**（`subagent/subagent/src/index.ts:518`
//   的注释：absent / idle / already-completed 都在那里被接受）→ `{ ok: true }` 且回执形状正确；
// - `mode` 不是 `"continuable"` 时在**我们这一层**就拒（descriptor 的枚举只有这一个值）；
// - `prompt` 在没有任何 provider 注册的装配里由上游报错（不是「没实现」）。
import { SandboxPolicyDefault, FsSandbox } from "@morlay/dsh-sandbox";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideSubagent } from "@morlay/dsh-subagent/server";
import { WorkingDirectoryDefault } from "@morlay/dsh-working-directory";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 起带 `remote.subagents` 的真栈（沙箱根用进程 cwd：这条用例不落盘）。 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [...provideSessionProjection(), ...provideTypert(),
    
      SessionStoreDefault,
      ...provideAgent(),
      configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: process.cwd() })([SandboxPolicyDefault]),
      FsSandbox,
      WorkingDirectoryDefault,
      RemoteHandlersDefault,
      ...provideSubagent(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("subagents/* 的宿主面", { timeout: 30_000 }, () => {
  it("interruptByParent 对没有活子代理的地址是接受的 no-op（回回执，不抛）", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("subagents/interruptByParent", {
      childSessionId: SessionId("child-none"),
      parentSessionId: SessionId("parent-none"),
      mode: "continuable",
    });
    expect(result).toMatchObject({ ok: true });
    // 回执形状（上游 `SubagentInterruptReceipt`：是否受理了这次取消信号）。
    expect(JSON.stringify(result)).toContain("accepted");
  });

  it("mode 不是 continuable 时在本层拒绝（descriptor 的枚举只有这一个值）", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("subagents/interruptByParent", {
      childSessionId: SessionId("child-none"),
      parentSessionId: SessionId("parent-none"),
      mode: "other",
    });
    expect(result).toMatchObject({ ok: false });
    const message = (result as { error?: { message?: string } }).error?.message ?? "";
    expect(message).toContain("continuable");
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
