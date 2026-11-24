// 智能体团队开关的**全链路**判据（宿主 + wire + 浏览器半都真跑）。
//
// 钉的是用户直接看见的那件事：开关打开之后，宿主侧的 `agentTeam` 投影（浏览器
// `useProjection('agentTeam')` 读的就是它）必须跟着翻。`__tests__/team.spec.ts` 只钉了宿主侧直调
// `setEnabled`；浏览器到宿主的那段 wire 往返断在哪测不出来——症状是"点了不回显 / 刷新后才对"。
//
// 宿主栈用本包自己那套（`team.spec.ts` 的清单 + wire 四行），不借别的域的端点行：
// 团队开关的 remote 只需要会话数据面，不需要对话域的端点面。
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { AgentDirectory, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { SessionProjectionStore } from "@morlay/dsh-session";
import {
  provideSession,
  provideSessionProjection,
  provideSessionQuerySqlite,
} from "@morlay/dsh-session/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideShell } from "@morlay/dsh-shell/server";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import {
  provideApiGateway,
  provideConnection,
  provideMuxServer,
  provideRemoteAccess,
  provideTypert,
  provideWeb,
  WebServer,
} from "@morlay/zephyr-app/testing";
import { TypertGateway } from "@morlay/zephyr-app";
import {
  ClientConnectionDefault,
  Locale,
  muxTransport,
  provideClientConnection,
  provideClientRemote,
  provideRenderer,
  RemoteDefault,
} from "@morlay/zephyr-app/client";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished, vi } from "vitest";
import { provideAgentTeam } from "../../server/agent-team.provide.ts";
import { provideAgentTeamUi } from "../agent-team.provide.ts";

const SESSION_ID = SessionId("team-live");

describe("智能体团队开关（真宿主 + 真浏览器半）", { timeout: 120_000 }, () => {
  test("浏览器调 remote.agentTeams.setEnabled 之后，宿主的 agentTeam 投影翻过来", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-agent-team-live-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    vi.stubEnv("PORT", "0");

    const host = await bootstrapApplication({
      providers: [
        // wire：`/api` 的 rpc 与 `/api/remote.mux` 的 upgrade（浏览器的事件流走它）。
        ...provideWeb(),
        ...provideConnection(),
        ...provideRemoteAccess(),
        ...provideTypert(),
        ...provideApiGateway(),
        ...provideMuxServer(),
        // 会话数据面（团队开关挂在会话的子代理树根上）。
        ...provideSessionPersistence(),
        ...provideSession(),
        ...provideSessionProjection(),
        ...provideSessionQuerySqlite(),
        { provide: AppEnv, useValue: createTestingAppEnv({ root: root }) },
        ...provideAgent(),
        ...provideAgentLoop(),
        ...provideShell(),
        ...provideSandbox(
          configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root }),
        ),
        ...provideWorkingDirectory(),
        // 被测域：团队两行 + 那份 remote descriptor。
        ...provideAgentTeam(),
      ],
      timeoutMs: 60_000,
    } as never);
    onTestFinished(() => host.dispose().catch(() => {}));
    const origin = `http://127.0.0.1:${String(host.get(WebServer).port)}`;

    const handle = await host.get(AgentDirectory).create({
      sessionId: SESSION_ID,
      meta: { cwd: root },
    });
    const session = handle.agent.session;

    const client = await bootstrapApplication({
      providers: [
        ...provideClientConnection(configure(ClientConnectionDefault, { origin })),
        ...provideClientRemote(),
        ...provideRenderer(),
        // 字典面：这条判 wire，不需要真 locale（行只要 `register` / `bind` 在）。
        {
          provide: Locale,
          useFactory: () => ({
            register: () => () => {},
            subscribe: () => () => {},
            bind: () => (key: string) => key,
          }),
        },
        ...provideAgentTeamUi(),
      ],
      timeoutMs: 30_000,
    });
    onTestFinished(() => client.dispose().catch(() => {}));
    client.get(RemoteDefault).useTransport(
      muxTransport(
        () =>
          ({
            openWebSocket: (path: string) =>
              new WebSocket(`${origin.replace(/^http/u, "ws")}${path}`),
          }) as never,
        (input, init) => fetch(`${origin}${new URL(String(input), origin).pathname}`, init),
      ),
    );

    // 事件流先就位：否则宿主推了也没人收。
    await vi.waitFor(
      () => expect(host.get(TypertGateway).hasLiveClient(), "浏览器的事件流要先就位").toBe(true),
      { timeout: 30_000 },
    );

    // 浏览器半的 `AgentTeamUi` 自己 $mount 那份 descriptor：等 `remote.agentTeams` 真的发布出来。
    // `Remote` 契约不列 namespace（它们是按 descriptor 动态挂上去的）：按名字取那一面。
    type AgentTeamsFace = {
      setEnabled(sessionId: string, enabled: boolean): Promise<{ ok: boolean }>;
    };
    const agentTeamsOf = (): AgentTeamsFace | undefined =>
      Reflect.get(client.get(RemoteDefault), "agentTeams") as AgentTeamsFace | undefined;
    await vi.waitFor(
      () => expect(agentTeamsOf(), "remote.agentTeams 要由 AgentTeamUi 挂上").toBeDefined(),
      { timeout: 30_000 },
    );
    const agentTeams = agentTeamsOf();

    const enabledOf = (): boolean =>
      host.get(SessionProjectionStore).snapshot(session).values["agentTeam"]?.enabled === true;
    expect(enabledOf(), "默认关").toBe(false);

    const response = await agentTeams?.setEnabled(String(SESSION_ID), true);
    expect(response?.ok, "写入要被宿主接受").toBe(true);
    await vi.waitFor(() => expect(enabledOf(), "宿主投影跟着翻").toBe(true), { timeout: 30_000 });

    await agentTeams?.setEnabled(String(SESSION_ID), false);
    await vi.waitFor(() => expect(enabledOf(), "关掉也跟着翻").toBe(false), { timeout: 30_000 });
  });
});
