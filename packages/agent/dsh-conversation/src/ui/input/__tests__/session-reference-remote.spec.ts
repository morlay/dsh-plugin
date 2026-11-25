/**
 * 客户端 `remote.sessionReferenceResolver` 的绑定：`@` 菜单的**会话候选**走这条 namespace。
 *
 * 缺口形状：`ui-reference` 的 `candidates()` 里 `ctx.remote.sessionReferenceResolver.candidates(...)`；
 * descriptor 没 `$mount` 时这个字段是 `undefined`，浏览器里就是
 * `TypeError: Cannot read properties of undefined (reading 'candidates')`。
 * 本用例只替传输层（`mockTransport`），`RemoteDefault` 与绑定行都是真实现。
 */
import { bootstrapApplication, configure } from "@morlay/zephyr";
import {
  ClientConnectionDefault,
  provideClientConnection,
  provideClientRemote,
  mockTransport,
  Remote,
  RemoteDefault,
} from "@morlay/zephyr-app/client";
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { onTestFinished } from "vitest";
import { SessionReferenceEndpointClient } from "../../session-reference-endpoint.client.ts";
import { namespaceOf } from "../../remote-namespace.ts";

/** `remote.sessionReferenceResolver` 的调用面（namespace 在契约上是动态面：按运行期形状收窄一次）。 */
interface SessionReferenceFace {
  candidates(
    agent: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; value?: readonly { sessionId?: string; mention?: string }[] }>;
}

describe("客户端 @ 会话候选的 remote 绑定", { timeout: 15_000 }, () => {
  test("装配后 `remote.sessionReferenceResolver.candidates` 可用，并按命名参数走 wire", async () => {
    const app = await bootstrapApplication({
      providers: [
        // 传输全替身（`mockTransport`）：连接只做 `RemoteDefault` 的依赖占位，不真连。
        // 配置走 feature：`provideClientConnection` 只认一份 `ClientConnectionDefault`，不能再并列一条。
        ...provideClientConnection(
          configure(ClientConnectionDefault, { origin: "http://127.0.0.1:1" }),
        ),
        ...provideClientRemote(),
        SessionReferenceEndpointClient,
      ],
      timeoutMs: 8_000,
    });
    onTestFinished(() => app.dispose().catch(() => {}));
    const remote = app.get(Remote);
    // `session-controller` 的那份 descriptor 由 `ClientRemoteModule` 自己挂；这里只替传输。
    const calls: { endpoint: string; args: unknown }[] = [];
    // `useTransport` 是 `RemoteDefault`（本装配的实现）的成员，契约不列它：按实现类收窄一次。
    (remote as RemoteDefault).useTransport(
      mockTransport({
        "sessionReferenceResolver/candidates": (payload) => {
          calls.push({ endpoint: "sessionReferenceResolver/candidates", args: payload.args });
          return { ok: true, value: [{ sessionId: "s2", mention: "@[会话二](dsh-session:s2)" }] };
        },
      }),
    );
    const face = namespaceOf(remote, "sessionReferenceResolver") as
      | SessionReferenceFace
      | undefined;
    expect(
      face,
      "descriptor 没挂上时这里就是 undefined（ui-reference 的 TypeError 来源）",
    ).toBeDefined();
    const result = await face?.candidates("s1", "hello");
    expect(result).toMatchObject({ ok: true });
    expect(result?.value?.map((candidate) => candidate.sessionId)).toContain("s2");
    // wire 上的键是 descriptor 的 `wire`（`agentId`）而不是调用方的形参名（`agent`）——
    // 用 `agent` 发出去，服务端 schema 会报 `missing "agentId"; unexpected "agent"`。
    expect(calls).toEqual([
      { endpoint: "sessionReferenceResolver/candidates", args: { agentId: "s1", query: "hello" } },
    ]);
  });
});
