// 完整链路（纯 node）：`SessionControllerHost` 注册的 handler ←→ 真 WebSocket ←→ `RemoteDefault` ←→ `SessionControllerDefault` 的 store。
//
// WebSocket 是协议不是平台：node 里 `new WebSocket(...)` 与服务端 `MuxServer` 就是这条链的两端，
// 不需要浏览器、不需要 happy-dom、不需要起应用。这一条把「建会话 → 事件 → store」串起来。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { onTestFinished } from "vitest";
import { muxTransport, RemoteDefault } from "@morlay/zephyr-app/client";
import { Remote } from "@morlay/zephyr-app/client";
import { provideClientRemote } from "@morlay/zephyr-app/client";
import { ClientConnectionDefault } from "@morlay/zephyr-app/client";
import { provideClientConnection } from "@morlay/zephyr-app/client";
import { provideSessionsStore } from "@morlay/dsh-conversation/ui";
import { SessionController } from "@morlay/dsh-conversation/ui";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { closeMux, serveMux } from "./support/mux-serve.ts";
import { namespaceOf } from "../remote-namespace.ts";

describe("会话链路（纯 node：真 WebSocket）", { timeout: 15_000 }, () => {
  test("host 注册的 handler 能被客户端调用，事件也能推回来", async () => {
    const { url, handlers, server, push } = await serveMux();
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
    // `session/list` 收到的 wire 参数键名：上游 `SessionController.list(_request, signal)` 的形参名是
    // `_request`（整组 26 条里只有它带下划线），客户端必须按这个名字发——按 `request` 发会被宿主
    // gateway 拒成 `args fields do not match the descriptor: unexpected "request"`。
    const listArgKeys: string[][] = [];
    handlers.register("session/list", async (args) => {
      listArgKeys.push(Object.keys(args));
      return { items: [...rows].map(([id, title]) => rowOf(id, title)) };
    });
    handlers.register("session/create", async () => {
      rows.set("s1", "会话一");
      push({ type: "emit", event: "api-session/added", args: [rowOf("s1", "会话一")] });
      return { sessionId: "s1" };
    });
    onTestFinished(() => closeMux(server));

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
      const remote = app.get(Remote);

      // `useTransport` 是 `RemoteDefault`（本装配的实现）的成员，契约不列它：按实现类收窄一次。
      // 两级 wire：流式与事件流走 socket（`url`），unary 走 HTTP（同一个 server 的 `/api`）。
      const httpOrigin = url.replace(/^ws/u, "http");
      (remote as RemoteDefault).useTransport(
        muxTransport(
          () => ({ openWebSocket: (path: string) => new WebSocket(`${url}${path}`) }) as never,
          (input, init) =>
            fetch(`${httpOrigin}${new URL(String(input), httpOrigin).pathname}`, init),
        ),
      );
      // **不在这里 `$mount` 上游那份 `TYPERT_REMOTE`**：那一行会把客户端的 `session` 组换成上游的
      // descriptor，于是 `list` 的 wire 名被上游那份盖对（`_request`），生产里（只有会话域自己挂）
      // 发的却是 `request`——错误因此一直被掩在这条用例里。客户端只应有一份挂载：会话域的客户端形态。
      await remote.whenNamespace("session");

      // `session` 是挂载之后才有的 namespace 面（契约不列）：与本包业务代码同一个读法。
      const face = namespaceOf(remote, "session") as
        | { list(): Promise<unknown>; create(request: unknown): Promise<unknown> }
        | undefined;
      if (face === undefined) throw new Error("`$mount` 之后 remote.session 必须存在");
      // wire 层统一给 `RemoteResult`（上游客户端按 `result.ok` 分流）。
      await expect(face.list()).resolves.toEqual({ ok: true, value: { items: [] } });
      await expect(face.create({})).resolves.toEqual({
        ok: true,
        value: { sessionId: "s1" },
      });
      // 判据是**客户端发出去的键名**：`session/list` 的 wire 名来自契约（`_request`；上游
      // `SessionController.list(_request, signal)` 的形参名，整组里唯一带下划线的那条）。
      // 按 `request` 发时宿主 gateway 会拒成 `unexpected "request"`——这条用例就是那个回归。
      expect(listArgKeys[0], `session/list 的 wire 参数键：${JSON.stringify(listArgKeys)}`).toEqual([
        "_request",
      ]);

      // 等推送经 `$events` 流回来（`SessionControllerDefault` 自己订阅了 `api-session/*`）。
      await new Promise((resolve) => setTimeout(resolve, 100));

      // store 那一段：`SessionControllerDefault` 订阅同样的频道，`upsert` 之后快照里该有这一行。
      // （DOM 渲染由 `app-assembly.spec` 在 happy-dom 里覆盖；这里到 store 为止。）
      const sessions = app.get(SessionController);
      await sessions.refresh();
      push({ type: "emit", event: "api-session/added", args: [rowOf("s2", "会话二")] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rowsNow = sessions.list.getSnapshot();
      expect(rowsNow.ids).toContain("s2");
      // 标题走 `title` 投影块（上游列表行读的就是这个键）。
      expect((rowsNow.byId[SessionId("s2")] as { title?: string } | undefined)?.title).toBe(
        "会话二",
      );
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
