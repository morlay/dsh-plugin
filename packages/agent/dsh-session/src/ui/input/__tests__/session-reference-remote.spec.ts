/**
 * 客户端 `remote.sessionReferenceResolver` 的绑定：`@` 菜单的**会话候选**走这条 namespace。
 *
 * 缺口形状：`ui-reference` 的 `candidates()` 里 `ctx.remote.sessionReferenceResolver.candidates(...)`；
 * descriptor 没 `$mount` 时这个字段是 `undefined`，浏览器里就是
 * `TypeError: Cannot read properties of undefined (reading 'candidates')`。
 * 本用例只替传输层（`mockTransport`），`RemoteDefault` 与绑定行都是真实现。
 */
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import {
  ClientConnectionDefault,
  provideClientConnection,
  provideClientRemote,
  mockTransport,
  Remote,
} from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { SessionReferenceRemoteBinding } from "../session-reference-remote.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

/** `remote.<namespace>` 在契约上是动态面：按运行期形状取用。 */
interface RemoteFace {
  useTransport(transport: unknown): void;
  sessionReferenceResolver?: {
    candidates(
      agent: string,
      query: string,
      signal?: AbortSignal,
    ): Promise<{ ok: boolean; value?: readonly { sessionId?: string; mention?: string }[] }>;
  };
}

describe("客户端 @ 会话候选的 remote 绑定", { timeout: 15_000 }, () => {
  it("装配后 `remote.sessionReferenceResolver.candidates` 可用，并按命名参数走 wire", async () => {
    const app = await bootstrapApplication({
      providers: [
        ...provideClientConnection(),
        ...provideClientRemote(),
        // 传输全替身（`mockTransport`）：连接只做 `RemoteDefault` 的依赖占位，不真连。
        ...configure(ClientConnectionDefault, { origin: "http://127.0.0.1:1" })([ClientConnectionDefault]),
        SessionReferenceRemoteBinding,
      ],
      timeoutMs: 8_000,
    });
    opened.push(app);
    const remote = app.get(Remote) as unknown as RemoteFace;
    // `session-controller` 的那份 descriptor 由 `ClientRemoteModule` 自己挂；这里只替传输。
    const calls: { endpoint: string; args: unknown }[] = [];
    remote.useTransport(
      mockTransport({
        "sessionReferenceResolver/candidates": (payload) => {
          calls.push({ endpoint: "sessionReferenceResolver/candidates", args: payload.args });
          return { ok: true, value: [{ sessionId: "s2", mention: "@[会话二](dsh-session:s2)" }] };
        },
      }),
    );
    const face = remote.sessionReferenceResolver;
    expect(
      face,
      "descriptor 没挂上时这里就是 undefined（ui-reference 的 TypeError 来源）",
    ).toBeDefined();
    const result = await face?.candidates("s1", "hello");
    expect(result).toMatchObject({ ok: true });
    expect(result?.value?.map((candidate) => candidate.sessionId)).toContain("s2");
    expect(calls).toEqual([
      { endpoint: "sessionReferenceResolver/candidates", args: { agent: "s1", query: "hello" } },
    ]);
  });
});
