// 完整链路（纯 node）：`SessionControllerHost` 注册的 handler ←→ 真 WebSocket ←→ `RemoteDefault` ←→ `SessionControllerDefault` 的 store。
//
// WebSocket 是协议不是平台：node 里 `new WebSocket(...)` 与服务端 `MuxServer` 就是这条链的两端，
// 不需要浏览器、不需要 happy-dom、不需要起应用。这一条把「建会话 → 事件 → store」串起来。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-api-session-controller/remote";
import { afterEach, describe, expect, it } from "vitest";
import { muxTransport } from "@morlay/zephyr-app/client";
import { Remote } from "@morlay/zephyr-app/client";
import { provideClientRemote } from "@morlay/zephyr-app/client";
import { ClientConnectionDefault } from "@morlay/zephyr-app/client";
import { provideClientConnection } from "@morlay/zephyr-app/client";
import { provideSessionsStore } from "@morlay/dsh-session/ui";
import { SessionController } from "@morlay/dsh-session/ui";
import { closeMux, serveMux } from "./support/mux-serve.ts";

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
}, 5_000);

describe("会话链路（纯 node：真 WebSocket）", { timeout: 15_000 }, () => {
  it("host 注册的 handler 能被客户端调用，事件也能推回来", async () => {
    const { url, handlers, server } = await serveMux();
    // host 侧：这是**mock server** 的两条实现（本用例只验 transport ↔ server ↔ store）。
    // 形状按上游 wire：`session/list` 是 `{ items: SessionSummary[] }`，标题经 `title` 投影下发。
    const rows = new Map<string, string>();
    /** 一行 `SessionSummary`（上游必需字段 + `title` 投影块）。 */
    const rowOf = (sessionId: string, title: string) => ({
      sessionId,
      agentAvailable: true,
      running: false,
      blank: false,
      updatedAt: 0,
      projections: { kind: "sequenced", asOfSeq: 0, values: { title } },
    });
    handlers.register("session/list", async () => ({ items: [...rows].map(([id, title]) => rowOf(id, title)) }));
    handlers.register("session/create", async () => {
      rows.set("s1", "会话一");
      handlers.publish("api-session/added", rowOf("s1", "会话一"));
      return { sessionId: "s1" };
    });
    closers.push(async () => await closeMux(server));


    // client 半：`RemoteDefault` 是真的，只把 socket 工厂指向这个 server。
    // 客户端半用**真实的模块**装配；`origin` 是 `ConnectionDefault` 的**显式配置**
    // （浏览器里默认取 `location`，非浏览器宿主必须给）——不是伪造全局。
    const app = await bootstrapApplication({
      providers: [
        ...provideClientConnection(
          configure(ClientConnectionDefault, {
            origin: `http://127.0.0.1:${String(new URL(url).port)}`,
          }),
        ),
        ...provideClientRemote(),
        // 会话 store 的 client 半。
        ...provideSessionsStore(),
      ],

      timeoutMs: 15_000,
    });
    try {
      const remote = app.get(Remote) as unknown as {
        $mount(c: unknown): Promise<() => Promise<void>>;
        useTransport(t: unknown): void;
        $on(channel: string, listener: (...args: never[]) => void): () => void;
        session: { list(): Promise<unknown>; create(request: unknown): Promise<unknown> };
      };

      remote.useTransport(muxTransport(() => ({ openWebSocket: (path: string) => new WebSocket(`${url}${path}`) }) as never));
      await remote.$mount(TYPERT_REMOTE);

      // wire 层统一给 `RemoteResult`（上游客户端按 `result.ok` 分流）。
      await expect(remote.session.list()).resolves.toEqual({ ok: true, value: { items: [] } });
      await expect(remote.session.create({})).resolves.toEqual({
        ok: true,
        value: { sessionId: "s1" },
      });

      // 等推送经 `$events` 流回来（`SessionControllerDefault` 自己订阅了 `api-session/*`）。
      await new Promise((resolve) => setTimeout(resolve, 100));

      // store 那一段：`SessionControllerDefault` 订阅同样的频道，`upsert` 之后快照里该有这一行。
      // （DOM 渲染由 `app-assembly.spec` 在 happy-dom 里覆盖；这里到 store 为止。）
      const sessions = app.get(SessionController) as unknown as {
        refresh(): Promise<unknown>;
        list: { getSnapshot(): { ids: readonly string[]; byId: Record<string, { title?: string }> } };
      };
      await sessions.refresh();
      handlers.publish("api-session/added", rowOf("s2", "会话二"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rowsNow = sessions.list.getSnapshot();
      expect(rowsNow.ids).toContain("s2");
      // 标题走 `title` 投影块（上游列表行读的就是这个键）。
      expect(rowsNow.byId["s2"]?.title).toBe("会话二");
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
