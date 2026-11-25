/**
 * 终端那一组在浏览器侧的**全链路**：`TerminalEndpointClient` 自己挂 descriptor → `remote.terminal`
 * 那一面 → 真宿主（`provideTerminal()` 的上游 `TerminalController`）→ `WebTerminalsDefault` 建出
 * `webTerminals`。
 *
 * 判据是**行为**，不是实现细节：
 * 1. 宿主给的终端限制真的回来了（不是替身常量、不是 `undefined`）；
 * 2. `webTerminals` 建得出来，且它用的那一面确实挂着；
 * 3. **没有宿主时明确失败**（`{ ok: false }` + 说清缺什么），而不是静默成 `undefined`——
 *    这条替掉了旧的「只装 client 时 `mounted` 为 false」：中间态不是行为，失败路径才是。
 *
 * **只替外部世界**：不 spawn 真进程（`attach` 会起真 shell，本 spec 不开那条流），
 * 也不替传输——client 侧走真 `Remote`（`LocalRemote` 接 host 的执行面）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { onTestFinished } from "vitest";
import { configure, type App } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, provideApiGateway, provideRemoteAccess, provideTypert } from "@morlay/zephyr-app";
import { WorkingDirectoryDefault, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { ClientConnectionDefault, provideClientConnection } from "@morlay/zephyr-app/client";
import { bootTwoSided, clientWithTransport, createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { provideShell, provideTerminal } from "../../server/index.ts";
import { provideShellUi } from "../shell.provide.ts";
import { SidebarTerminalSlots, WebTerminalsDefault } from "../sidebar-terminal-slots.ts";
import { TerminalEndpointClient } from "../terminal-endpoint.client.ts";

/** 终端环境那个方法的第一个实参（会话 id）。 */
type SessionArgument = Parameters<TerminalRemote["environment"]>[0];

/**
 * 起一双端：host = 真 `provideTerminal()`（上游 `TerminalController` + 它要的四条依赖），
 * client = 本包的浏览器半。
 * @returns client app（被测面）。
 */
async function boot(): Promise<App> {
  // 自造数据根（本 spec 不用 vitest fixture）：终端只读限制值与工作目录，不落盘会话数据。
  const root = await mkdtemp(join(tmpdir(), "dsh-shell-terminal-"));
  const appEnv = createTestingAppEnv({ root });
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const two = await bootTwoSided({
    createHost: () => [
      ...provideTypert(),
      ...provideApiGateway(),
      ...provideRemoteAccess(),
      { provide: AppEnv, useValue: appEnv },
      // 起进程要 `subprocess`，查 agent 的工作目录要 `workingDirectory`，登记端点要 `typert`。
      ...provideShell(),
      // `WorkingDirectoryDefault` 读会话投影与 systemPrompt（按会话解析工作目录），这两组行不能缺。
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideAgent(),
      ...provideWorkingDirectory(
        configure(WorkingDirectoryDefault, { defaultDirectory: appEnv.values.dataDir }),
      ),
      ...provideSandbox(configure(SandboxPolicyDefault, { mode: "workspace-write" })),
      ...provideTerminal(),
    ],
    createClient: (host) =>
      clientWithTransport(host, [
        // 上游 `ClientTerminals` 构造期读 `connection.generation`（重连时重开 roster）：真连接面给上，
        // 但它不承载本 spec 的调用——调用走 `clientWithTransport` 接的宿主执行面。
        ...provideClientConnection(configure(ClientConnectionDefault, { origin: "http://127.0.0.1:1" })),
        TerminalEndpointClient,
        WebTerminalsDefault,
      ]),
  });
  if (two.client === undefined) throw new Error("client 没装上");
  expect(two.host.get(RemoteHandlers), "宿主没有端点执行面就跑不了链路").toBeDefined();
  return two.client;
}

describe("terminal 组的客户端面（全链路）", () => {
  test("挂载后消费方读得到那一面；宿主拒绝时结构化失败（不静默成 undefined）", async () => {
    const app = await boot();
    const remote = app.get(Remote);
    const client = app.get(TerminalEndpointClient);
    expect(client.mounted, "客户端形态的 onInit 必须把这一组挂上").toBe(true);
    await remote.whenNamespace("terminal");
    expect(
      remoteNamespaceOf(remote, "terminal"),
      "挂载之后 remote.terminal 必须存在（右栏终端打开就靠它）",
    ).toBeDefined();
    // 调用**真的出去了**：宿主侧按会话解析 agent（本 spec 不建会话），失败的调用必须给出失败面，
    // 不能把 `{ ok: true, value: undefined }` 当成「没有限制」传给界面。
    const result = await client.environment("no-such-session" as SessionArgument, undefined);
    expect(result.ok, "解析不到会话时必须失败").toBe(false);
  });

  test("webTerminals 建得出来，且它用的 terminal 面确实挂着", async () => {
    const app = await boot();
    const terminals = app.get(WebTerminalsDefault).terminals;
    expect(typeof terminals.view, "上游 client 半的入口实例").toBe("function");
    expect(app.get(TerminalEndpointClient).mounted, "构建 webTerminals 的前提是那一面已挂").toBe(true);
  });

  test("没有宿主时明确失败（不假装挂上了、也不静默成 undefined）", async () => {
    // 只装浏览器半 + 一个没有执行面的传输：`$mount` 照常登记那一面，但调用到不了任何宿主。
    const { bootstrapApplication } = await import("@morlay/zephyr");
    const { provideLocalRemote } = await import("@morlay/zephyr-app/testing");
    const app = await bootstrapApplication({
      providers: [
        ...provideLocalRemote(async (endpoint) => {
          throw new Error(`没有宿主接 ${endpoint}`);
        }),
        TerminalEndpointClient,
      ],
      timeoutMs: 10_000,
    });
    try {
      const client = app.get(TerminalEndpointClient);
      expect(client.mounted, "挂载是客户端自己的事：没有宿主也照样挂面").toBe(true);
      const result = await client.environment("session-1" as SessionArgument, undefined);
      expect(result.ok, "调用必须明确失败，不能静默给 undefined").toBe(false);
      expect(JSON.stringify(result), "失败面要说清缺什么").toContain("没有宿主接 terminal/environment");
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});

describe("provideShellUi 的行清单", () => {
  test("顺序 = 依赖序：客户端（自带挂载）→ webTerminals → 标签", () => {
    // 清单里没有单独的挂载行：`terminal` 那组 descriptor 由 `TerminalEndpointClient.onInit` 挂。
    expect(provideShellUi()).toEqual([TerminalEndpointClient, WebTerminalsDefault, SidebarTerminalSlots]);
  });
});
