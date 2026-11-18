/**
 * 终端那一组在浏览器侧的真装配：`RemoteMountsDefault` 挂 descriptor → `TerminalEndpointClient` 走
 * `remote.terminal` 那一面 → `WebTerminalsDefault` 用它建出 `webTerminals`。
 *
 * 判据是**wire 上的帧**（假 transport），不是「拿到一个带 environment 的对象」：终端组的方法在 wire 上
 * 是命名参数（`agentId` / `id`），`attach` / `retain` / `watch` 是流式——转发写错时这里会直接看不到调用。
 */
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import type { App } from "@morlay/zephyr";
import {
  ClientConnectionDefault,
  mockTransport,
  provideClientConnection,
  provideClientRemote,
  Remote,
  RemoteDefault,
} from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteMountsDefault } from "../remote-mounts.service.ts";
import { provideShellUi } from "../shell.provide.ts";
import { SidebarTerminalSlots, WebTerminalsDefault } from "../sidebar-terminal-slots.ts";
import { TerminalEndpointClient } from "../terminal-endpoint-client.ts";

const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 一次 `terminal/environment` 的最小回执（形状按上游 schema）。 */
const ENVIRONMENT = {
  cwd: "/work",
  maxInputBytes: 65536,
  maxBufferedBytes: 1048576,
  maxCols: 500,
  maxRows: 200,
  scrollback: 5000,
};

/** 终端环境那个方法的第一个实参（会话 id）。 */
type SessionArgument = Parameters<TerminalRemote["environment"]>[0];

/**
 * 起一份最小装配。
 * @param providers - 本域的行（顺序由用例决定）。
 * @param streams - 流式端点的替身。
 * @returns 装配好的 app 与收到的 wire 调用。
 */
async function boot(
  providers: readonly unknown[],
  streams: Readonly<Record<string, (payload: { readonly args?: unknown }) => AsyncIterable<unknown>>> = {},
): Promise<{
  app: App;
  seen: { endpoint: string; args: unknown }[];
  seenStreams: { endpoint: string; args: unknown }[];
}> {
  const seen: { endpoint: string; args: unknown }[] = [];
  const seenStreams: { endpoint: string; args: unknown }[] = [];
  const transport = mockTransport(
    {
      "terminal/environment": (payload) => {
        seen.push({ endpoint: "terminal/environment", args: payload.args });
        return ENVIRONMENT;
      },
    },
    Object.fromEntries(
      Object.entries(streams).map(([endpoint, handler]) => [
        endpoint,
        (payload: { readonly args?: unknown }) => {
          seenStreams.push({ endpoint, args: payload.args });
          return handler(payload);
        },
      ]),
    ),
  );
  const app = await bootstrapApplication({
    providers: [
      ...provideClientConnection(configure(ClientConnectionDefault, { origin: "http://127.0.0.1:1" })),
      ...provideClientRemote(),
      ...(providers as never[]),
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);
  app.get(RemoteDefault).useTransport(transport);
  return { app, seen, seenStreams };
}

describe("terminal 组的客户端面", () => {
  it("挂载后 environment 真的到达传输层，wire 上是 { agentId }", { timeout: 20_000 }, async () => {
    const { app, seen } = await boot([RemoteMountsDefault, TerminalEndpointClient]);
    const client = app.get(TerminalEndpointClient);
    expect(client.mounted, "RemoteMountsDefault 跑过之后这一组就有面了").toBe(true);

    const result = await client.environment("session-1" as SessionArgument, undefined);
    // 面的返回值与上游同形（`ClientTerminals` 按 `result.ok` / `result.value` 读）。
    expect(result).toEqual({ ok: true, value: ENVIRONMENT });
    // 命名参数来自 descriptor：转发若走 `invoke(…, { request })`，这里是 `{ request }`。
    expect(seen).toEqual([{ endpoint: "terminal/environment", args: { agentId: "session-1" } }]);
  });

  it("流式方法（attach）拿到逐帧面，wire 上是 { agentId, id }", { timeout: 20_000 }, async () => {
    const { app, seenStreams } = await boot([RemoteMountsDefault, TerminalEndpointClient], {
      "terminal/attach": async function* () {
        yield { type: "snapshot", sequence: 1, screen: "", info: {} };
      },
    });
    const client = app.get(TerminalEndpointClient);
    const handle = client.attach("session-1" as SessionArgument, "tt-1" as never, undefined);
    const frames: unknown[] = [];
    for await (const frame of handle) frames.push(frame);
    expect(frames).toEqual([{ type: "snapshot", sequence: 1, screen: "", info: {} }]);
    expect(seenStreams).toEqual([{ endpoint: "terminal/attach", args: { agentId: "session-1", id: "tt-1" } }]);
    expect(typeof handle.send, "上行写入面在（终端要能输入）").toBe("function");
  });

  it("没挂载时调用直接报出「还没挂载」，不静默成 undefined", { timeout: 20_000 }, async () => {
    const { app } = await boot([TerminalEndpointClient]);
    const client = app.get(TerminalEndpointClient);
    expect(client.mounted).toBe(false);
    // 转发是**同步**抛：face() 缺面时错就抛在调用处（defineForwarder 不回落 unary invoke），
    // 调用方按 try/catch 处理即可；不会静默成 undefined，也不会漂成 this.remote.x is not a function。
    expect(() => client.environment("session-1" as SessionArgument, undefined)).toThrow(
      /RemoteMountsDefault 必须排在/,
    );
  });
});

describe("webTerminals 的装配", () => {
  it("RemoteMountsDefault 在前时建出 webTerminals", { timeout: 20_000 }, async () => {
    const { app } = await boot([RemoteMountsDefault, TerminalEndpointClient, WebTerminalsDefault]);
    const terminals = app.get(WebTerminalsDefault).terminals;
    expect(typeof terminals.view, "上游 client 半的入口实例").toBe("function");
    expect(app.get(Remote)).toBeDefined();
  });

  it("少了 RemoteMountsDefault 时装配就报顺序错", { timeout: 20_000 }, async () => {
    await expect(boot([TerminalEndpointClient, WebTerminalsDefault])).rejects.toThrow(
      /RemoteMountsDefault 必须排在 WebTerminalsDefault 之前/,
    );
  });
});
describe("provideShellUi 的行清单", () => {
  it("顺序 = 依赖序：客户端 → 挂载 → webTerminals → 标签", { timeout: 20_000 }, () => {
    // 跑真装配才发现的坑：少了 `TerminalEndpointClient` 这一行，浏览器里报
    // 「没有提供者：terminal-endpoint（WebTerminalsDefault 需要它）」，而 tsc 看不见 provider 清单。
    expect(provideShellUi()).toEqual([
      TerminalEndpointClient,
      RemoteMountsDefault,
      WebTerminalsDefault,
      SidebarTerminalSlots,
    ]);
  });
});
