// `provideAgentTeam()` 的装配判据：两行都装得上、服务面是上游实例、依赖链不缺环。
//
// 依赖链比想象中长：团队服务要 `SubagentRegistry` → working-directory → file-system → 沙箱 → subprocess。
// 本包不反向依赖 app，所以按这条链显式装各域（**顺序即依赖**，与 `apps/zephyr-custom` 同一套）。
import { AgentDirectory, SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { provideSubagent } from "@morlay/dsh-agent-loop";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-agent";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { AppEnvDefault, RemoteHandlersDefault, provideAppEnv } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { TeamServiceDefault, ToolAgentTeam, provideAgentTeam } from "@morlay/dsh-agent-team/server";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 60_000);

/** 团队两行要的**整条**依赖链（缺一环会在装配期点名报出来）。 */
function providers(): readonly unknown[] {
  const cwd = "/tmp/agent-team-cwd";
  return [
    ...provideAppEnv(
      configure(AppEnvDefault, {
        profileDir: "/tmp/agent-team-profile",
        dataDir: "/tmp/agent-team-data",
      }),
    ),
    ...provideSessionPersistence(),
    ...provideSession(),
    ...provideSessionProjection(),
    ...provideAgent(),
    // file-system 由沙箱域的 `FsSandbox` 提供；shell 给 `subprocess`。
    ...provideShell(),
    ...provideSandbox(
      configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: cwd }),
    ),
    ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: cwd })),
    RemoteHandlersDefault,
    ...provideSubagent(),
    ...provideAgentTeam(),
  ];
}

describe("Agent Teams 的装配", () => {
  it("两行都装得上，服务面是上游 TeamService 的实例", async () => {
    const app = await bootstrapApplication({ providers: providers() as never, timeoutMs: 60_000 });
    opened.push(app);
    // 适配行的契约面由上游实例兑现——不是空壳（`TeamService` 的成员名上游会动，
    // 所以判「它确实是我们契约的实现」，不锁具体成员）。
    // 上游 `TeamService` 是 cordis `Service` 子类：服务名就是它注册的名字（成员名上游会动，
    // 所以判「注册名对得上」，不锁具体成员）。
    const teams = app.get(TeamServiceDefault) as { name?: string };
    expect(teams.name).toBe("agentTeams");
    expect(app.get(ToolAgentTeam)).toBeDefined();
  });

  it("依赖链上的每一环都在同一个装配里", async () => {
    const app = await bootstrapApplication({ providers: providers() as never, timeoutMs: 60_000 });
    opened.push(app);
    expect(app.get(AgentDirectory)).toBeDefined();
    expect(app.get(SessionStore)).toBeDefined();
    expect(app.get(SessionProjectionStore)).toBeDefined();
    expect(app.get(ToolRegistry)).toBeDefined();
    expect(app.get(SystemPrompt)).toBeDefined();
  });
});
