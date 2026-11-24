// 业务工作流的**真全流程**判据（宿主 + 浏览器都真跑）：宿主新建会话 → 推送 → 侧栏出现。
//
// 这条钉的是用户直接看见的那件事：点「新建会话」之后侧栏里有没有那一行。它靠的不是再拉一次
// `session/list`，而是宿主发 `api-session/added`、经 `$events` 到浏览器、store 据此 upsert。
// 之前只有 wire 层的通路用例（unary / stream / waterfall），这条推送链断在哪一段测不出来。
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { AgentDirectory, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideSandbox } from "@morlay/dsh-sandbox";
import {
  provideSession,
  provideSessionProjection,
  provideSessionQuerySqlite,
} from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideStorage, provideStorageJson } from "@morlay/dsh-storage";
import { provideUpload } from "@morlay/dsh-upload";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { SubprocessDefault } from "@morlay/dsh-shell";
import {
  CredentialsInMemory,
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
  muxTransport,
  provideClientConnection,
  provideClientRemote,
  RemoteDefault,
} from "@morlay/zephyr-app/client";
import { provideSessionsStore, SessionController } from "@morlay/dsh-conversation/ui";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { onTestFinished, vi } from "vitest";
import { provideApiSession } from "../../server/api-session.provide.ts";

/** 临时数据根（本用例自己建、自己删）。 */
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-session-list-live-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** 起宿主栈（与 dev 同形的那些行）。 */
async function bootHost(root: string): Promise<App> {
  vi.stubEnv("PORT", "0");
  const app = await bootstrapApplication({
    providers: [
      ...provideWeb(),
      CredentialsInMemory,
      ...provideConnection(),
      ...provideTypert(),
      ...provideApiGateway(),
      ...provideMuxServer(),
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      { provide: AppEnv, useValue: createTestingAppEnv({ root: root }) },
      ...provideAgent(),
      // `AgentDirectory.create` 要一份创建工厂（用户点「新建会话」走的就是这一行）。
      ...provideAgentLoop(),
      ...provideAttachment(),
      ...provideCommand(),
      ...provideUpload(),
      ...provideSandbox(),
      ...provideStorage(),
      ...provideStorageJson(),
      ...provideSessionPersistence(),
      ...provideWorkingDirectory(),
      ...provideWorkspace(),
      ...provideRemoteAccess(),
      SubprocessDefault,
      // 上游会话端点：`session/list` 与 `api-session/*` 推送都从这一行来。
      ...provideApiSession(),
    ],
    timeoutMs: 30_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return app;
}

describe("新建会话（真宿主 + 真浏览器半）", { timeout: 30_000 }, () => {
  test("宿主建出会话后，浏览器的列表靠推送自己出现（不再拉 list）", async () => {
    const root = await temporaryRoot();
    const host = await bootHost(root);
    const origin = `http://127.0.0.1:${String(host.get(WebServer).port)}`;

    const client = await bootstrapApplication({
      providers: [
        ...provideClientConnection(configure(ClientConnectionDefault, { origin })),
        ...provideClientRemote(),
        ...provideSessionsStore(),
      ],
      timeoutMs: 20_000,
    });
    onTestFinished(() => client.dispose().catch(() => {}));
    // **先换载体再取会话面**：会话面的 onInit 会 `$on` 订阅推送，订阅一发生就按当时的载体建连；
    // 反过来（先取会话面）会先建一条用默认载体的 socket，换掉之后那条连接没人收，宿主侧也就
    // 没有活跃的事件流可推。
    // 非浏览器宿主没有 `location`：socket 与 unary 都接到本用例的宿主上。
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
    const sessions = client.get(SessionController);
    await sessions.refresh();
    expect(sessions.list.getSnapshot().ids, "起手没有会话").toEqual([]);

    // 推送的前提：浏览器的事件流必须已经在宿主侧登记（否则宿主推了也没人收）。
    await vi.waitFor(
      () => expect(host.get(TypertGateway).hasLiveClient(), "浏览器的事件流要先就位").toBe(true),
      { timeout: 10_000 },
    );

    // 推送的前提：浏览器的事件流必须已经在宿主侧登记（否则宿主推了也没人收）。
    await vi.waitFor(
      () => expect(host.get(TypertGateway).hasLiveClient(), "浏览器的事件流要先就位").toBe(true),
      { timeout: 10_000 },
    );

    // 宿主侧建会话：与用户在界面上点「新建会话」走的是同一行。
    await host.get(AgentDirectory).create({
      sessionId: SessionId("live-1"),
      meta: { cwd: root },
    });

    await vi.waitFor(
      () => expect(sessions.list.getSnapshot().ids, "推送要让它出现在列表里").toContain("live-1"),
      { timeout: 15_000 },
    );
  });
});
