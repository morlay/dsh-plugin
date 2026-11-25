/**
 * `SessionController.list` 的 store 语义：装配时从 Host 拉一次目录、宿主推送写回、
 * 订阅者在快照变化时收到通知。
 *
 * 这一层不碰 DOM、不碰渲染——只证明「契约面 `list` 是活的」。
 * 只替传输层（`FakeRemote`）；store 与 `SessionRemote` 都是真实现。
 */
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport, Remote, SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { SessionController, type SessionCatalogState } from "@morlay/dsh-conversation/contract";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote } from "./support/fake-remote.ts";

/**
 * 等条件成立（follow / 首帧拉取都是异步的，别用固定时长猜）。
 *
 * 等不到就**抛**：静默返回会把「条件写错了」变成一段看不见的 2s 空转——这里踩过一次。
 * @param check - 条件。
 * @param timeoutMs - 上限（只用来兜底失败，不是等待时长）。
 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 10) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (check()) return;
  throw new Error(`until：条件在 ${String(timeoutMs)}ms 内没有成立`);
}

/** 一行宿主的会话摘要（`api-session/added` 的载荷形状）。 */
function summaryOf(id: string): {
  id: string;
  sessionId: string;
  title: string;
  cwd: string;
  blank: boolean;
  running: boolean;
  updatedAt: number;
  retainedBy: Record<string, number>;
} {
  return {
    id,
    sessionId: id,
    title: `会话 ${id}`,
    cwd: "/tmp/w",
    blank: true,
    running: false,
    updatedAt: 1,
    retainedBy: {},
  };
}

/**
 * 起真 store + 假传输。
 * @param listReply - 宿主对首次 `session/list` 的应答（装配时 `onInit` 会拉一次）。
 * @returns 应用、契约实例与传输替身。
 */
async function boot(
  listReply: () => unknown = () => ({ items: [] }),
  mounted?: Promise<void>,
  streams: Parameters<typeof mockTransport>[1] = {},
): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  sessions: SessionController;
  remote: FakeRemote;
}> {
  FakeRemote.next = {
    handlers: { "session/list": listReply },
    streams,
    ...(mounted === undefined ? {} : { mounted }),
  };
  const app = await bootstrapApplication({
    providers: [...provideSessionsStore(), FakeRemote, SessionRemoteDefault],
    timeoutMs: 8_000,
  });
  const sessions = app.get(SessionController);
  // 装配时的那次目录拉取是 fire-and-forget：`retain` 之前必须等它落地，否则上游 `resolveTarget`
  // 会以 `unknown session` 拒绝（`summaries` 还是空的）。
  await sessions.refresh();
  return {
    app,
    sessions,
    // 替身与契约共用同一个令牌（实现类继承契约不另立身份）：按契约取，类型收窄到替身。
    remote: app.get(Remote) as FakeRemote,
  };
}

/** `SessionController.list` 的快照读取（契约声明的 observable）。 */
function snapshotOf(sessions: SessionController): SessionCatalogState {
  return sessions.list.getSnapshot();
}

describe("SessionController.list 的 store", { timeout: 10_000 }, () => {
  test("宿主推 `api-session/added` 时把一行写回 list", async () => {
    const { app, sessions, remote } = await boot();
    try {
      const summary = summaryOf("s1");
      remote.emit("api-session/added", summary);
      // `handleSessionAdded` 之后目录是**异步**投影的（manager 的 notifier），同步断言会读到旧快照。
      await until(() => snapshotOf(sessions).ids.length === 1);
      expect(snapshotOf(sessions).ids).toEqual(["s1"]);
      expect(snapshotOf(sessions).byId["s1"]).toMatchObject({ title: "会话 s1" });
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  test("宿主推 `api-session/removed` 时把那一行从 list 移除", async () => {
    const { app, sessions, remote } = await boot();
    try {
      remote.emit("api-session/added", summaryOf("s1"));
      await until(() => snapshotOf(sessions).ids.length === 1);
      expect(snapshotOf(sessions).ids).toEqual(["s1"]);
      remote.emit("api-session/removed", "s1");
      await until(() => snapshotOf(sessions).ids.length === 0);
      expect(snapshotOf(sessions).ids).toEqual([]);
      expect(snapshotOf(sessions).byId["s1"]).toBeUndefined();
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  test("retain 返回上游 `SessionReference` 的形状，且没有子代理地址", async () => {
    const { app, sessions } = await boot(() => ({ items: [{ ...summaryOf("s1") }] }));
    try {
      const reference = sessions.retain(SessionId("s1"), { source: "gateway" });
      expect(reference.sessionId).toBe("s1");
      // 缺 `release` 就是 `replaceMain` / `restoreSelection` 崩。
      expect(typeof reference.release).toBe("function");
      expect(() => reference.release()).not.toThrow();
      expect(sessions.subagentAddress(SessionId("s1"))).toBeUndefined();
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});

describe("retainInfo：行的保留计数", () => {
  test(
    "`retain` 后 mainView 为 1，`release` 后回 0，订阅者收到变化",
    { timeout: 10_000 },
    async () => {
      const { app, sessions } = await boot(() => ({ items: [{ ...summaryOf("s1") }] }), undefined, {
        "session/follow": async function* () {},
      });
      try {
        const info = sessions.retainInfo(SessionId("s1")) as {
          getSnapshot(): { retainedBy?: Record<string, number> };
          subscribe(listener: () => void): () => void;
        };
        let notified = 0;
        info.subscribe(() => {
          notified += 1;
        });

        const reference = sessions.retain(SessionId("s1"), { source: "mainView" });
        // 上游 `ui-session` 的 `publishMain` 读这一位判断「当前 main 是否仍是 main」；恒空会让它
        // 回落成扫 `byId` 找第一个 mainView>0，旧会话的残留计数就把主区钉在旧会话上。
        expect(info.getSnapshot().retainedBy?.mainView).toBe(1);
        expect(notified, "保留计数变化要通知订阅者").toBeGreaterThan(0);

        reference.release();
        expect(info.getSnapshot().retainedBy?.mainView).toBeUndefined();
      } finally {
        await app.dispose().catch(() => {});
      }
    },
  );
});

describe("retainInfo：按 source 分开计数", () => {
  test(
    "`sidebarView` 的保留不记到 `mainView` 上（否则主区判断会被顶住）",
    { timeout: 10_000 },
    async () => {
      const { app, sessions } = await boot(() => ({ items: [{ ...summaryOf("s1") }] }), undefined, {
        "session/follow": async function* () {},
      });
      try {
        const info = sessions.retainInfo(SessionId("s1")) as {
          getSnapshot(): { retainedBy?: Record<string, number> };
        };
        // 侧栏 / 技能目录各自 hold 一个引用：上游 `publishMain` 只看 `mainView`，
        // 把别的 source 记到 `mainView` 会让「有没有主区会话」永远为真——主区就切不走。
        const side = sessions.retain(SessionId("s1"), { source: "sidebarView" });
        expect(info.getSnapshot().retainedBy?.mainView).toBeUndefined();
        expect(info.getSnapshot().retainedBy?.sidebarView).toBe(1);
        side.release();
        expect(info.getSnapshot().retainedBy?.sidebarView).toBeUndefined();
      } finally {
        await app.dispose().catch(() => {});
      }
    },
  );
});

describe("列表里没有的 id 不产生 binding", () => {
  test(
    "`byId` 残留了不在 `ids` 里的行时，`binding()` 仍返回 `undefined`（`ids` 是权威）",
    { timeout: 10_000 },
    async () => {
      // 目录里有两行：`byId` 有 s2 的行，但这条用例只 retain s1。
      const { sessions } = await boot(
        () => ({ items: [{ ...summaryOf("s1") }, { ...summaryOf("s2") }] }),
        undefined,
        { "session/follow": async function* () {} },
      );
      await until(() => snapshotOf(sessions).ids.length === 2);

      // 前提要真：byId 里确实有 s2 那一行——否则「不产生 binding」是白断。
      expect(snapshotOf(sessions).byId["s2"], "byId 里应当有 s2 的行").toBeDefined();
      // 上游 `binding` 只认**已物化的 scope**（`scopes.get(id)?.binding`）：没 retain 过就是 undefined。
      // 这条钉的是「不编造 binding」——编造会让 `ui-session` 把不存在的会话当 main。
      expect(sessions.binding("s2")).toBeUndefined();
      sessions.retain(SessionId("s1"), { source: "gateway" });
      expect(sessions.binding("s1")).toBeDefined();
      expect(sessions.binding("s2"), "retain 了 s1 也不该顺带物化 s2").toBeUndefined();
    },
  );
});

describe("投影摘要摊平", () => {
  test(
    "宿主行的 `projections.values` 变成客户端行的 `projectionValues`（`restoreBlank` 读它）",
    { timeout: 10_000 },
    async () => {
      const { sessions } = await boot(
        () => ({
          items: [
            {
              ...summaryOf("s1"),
              projections: { kind: "sequenced", asOfSeq: 3, values: { agentPreset: "cordis" } },
            },
          ],
        }),
        undefined,
        { "session/follow": async function* () {} },
      );
      await until(() => snapshotOf(sessions).ids.length === 1);
      expect(snapshotOf(sessions).byId["s1"]).toMatchObject({
        projectionValues: { agentPreset: "cordis" },
      });
    },
  );
});
