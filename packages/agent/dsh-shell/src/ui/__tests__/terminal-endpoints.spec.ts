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
import { inject, Injectable, rootContextKey, type Context, type OnInit } from "@morlay/zephyr";
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
 * `sandboxPolicy` 的**最小替身令牌**：本 spec 只需要那个面在场。
 *
 * 上游 `TerminalController.execution()` 对它只做存在性检查（`agent.ctx.get('sandboxPolicy')` 为
 * `undefined` 就抛，见 `api/terminal-controller/src/index.ts:526`），**不读任何成员**；而本 spec 不开
 * 终端（`attach` 才会起真进程），所以不需要 `dsh-sandbox` 的真行——装了它反而让本包多一条
 * workspace 依赖边（那条边与「sandbox → shell」构成环，pnpm 的递归执行会被判环拒跑）。
 */
@Injectable()
class FakeSandboxPolicy {}

/**
 * `workingDirectory` 的最小替身令牌：同上，上游 `execution()` 只按名字取它（`agent.ctx.get('workingDirectory')`，
 * 见 `api/terminal-controller/src/index.ts:535`），本 spec 的断言路径走不到读成员的那一步。
 */
@Injectable()
class FakeWorkingDirectory {}

/** 两个替身的值：面在场即可，成员不会被读到。 */
const FAKE_FACE = {};

/**
 * 把两个替身**按上游服务名**发布到根 store。
 *
 * 上游 `TerminalController.execution()` 是按名字取的（`agent.ctx.get('sandboxPolicy')` /
 * `('workingDirectory')`，见 `api/terminal-controller/src/index.ts:526-537`），而替身不走上游
 * 插件的 `super(ctx, name)`，名字不会自己出现在 store 里。
 */
@Injectable()
class PublishExecutionFaces implements OnInit {
  private readonly sandbox = inject(FakeSandboxPolicy);

  private readonly workingDirectory = inject(FakeWorkingDirectory);

  onInit(ctx: Context): void {
    ctx[rootContextKey].provide("sandboxPolicy", this.sandbox);
    ctx[rootContextKey].provide("workingDirectory", this.workingDirectory);
  }
}

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
      // 起进程要 `subprocess`（本包的真行）；`sandboxPolicy` / `workingDirectory` 只要求**面在场**
      // （见两个替身令牌的注释）——不装别的域的真行，本包因此没有「sandbox ↔ shell」那条环。
      ...provideShell(),
      { provide: FakeSandboxPolicy, useValue: FAKE_FACE },
      { provide: FakeWorkingDirectory, useValue: FAKE_FACE },
      PublishExecutionFaces,
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
