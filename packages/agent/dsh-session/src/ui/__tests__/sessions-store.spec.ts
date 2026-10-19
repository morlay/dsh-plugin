// @vitest-environment happy-dom
/**
 * `SessionController.list` 的 store 语义：装配时从 Host 拉一次目录、宿主推送写回、
 * 订阅者在快照变化时收到通知。
 *
 * 这一层不碰 DOM、不碰渲染——只证明「契约面 `list` 是活的」。
 * 只替传输层（`FakeRemote`）；store 与 `SessionRemote` 都是真实现。
 */
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport, SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { SessionController, type SessionCatalogState } from "../session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote } from "./support/fake-remote.ts";

/** 等条件成立（follow / 首帧拉取都是异步的，别用固定时长猜）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
  listReply: () => unknown = () => ({ ids: [], byId: {} }),
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
    providers: [...provideSessionsStore(),
    FakeRemote, SessionRemoteDefault],
    timeoutMs: 8_000,
  });
  return {
    app,
    sessions: app.get(SessionController),
    remote: app.get(FakeRemote),
  };
}

/** `SessionController.list` 的快照读取（契约声明的 observable）。 */
function snapshotOf(sessions: SessionController): SessionCatalogState {
  return sessions.list.getSnapshot();
}

describe("SessionController.list 的 store", { timeout: 10_000 }, () => {
  it("宿主推 `api-session/added` 时把一行写回 list", async () => {
    const { app, sessions, remote } = await boot();
    try {
      const summary = summaryOf("s1");
      remote.emit("api-session/added", summary);
      expect(snapshotOf(sessions).ids).toEqual(["s1"]);
      expect(snapshotOf(sessions).byId["s1"]).toMatchObject({ title: "会话 s1" });
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("装配**等** `$mount` 完成后才拉目录：完成时快照已就绪（首次 refresh 不允许 `void`）", async () => {
    // `$mount` 未完成时装配不应完成——这是修「每次 reload 多建一个会话」的那条保证：
    // 上游 `ui-workspace` 的 `restoreSelection` 假定「装配完成时列表已就绪」。
    const mounted = Promise.withResolvers<void>();
    let settled = false;
    const booting = boot(() => ({ ids: ["s1"], byId: { s1: summaryOf("s1") } }), mounted.promise);
    void booting.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled, "`$mount` 未完成时装配不应完成").toBe(false);

    mounted.resolve();
    const { app, sessions } = await booting;
    try {
      expect(snapshotOf(sessions).ids).toEqual(["s1"]);
      expect(snapshotOf(sessions).phase).toBe("ready");
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("`api-session/activity` 更新那一行的时间戳", async () => {
    const { app, sessions, remote } = await boot();
    try {
      remote.emit("api-session/added", summaryOf("s1"));
      remote.emit("api-session/activity", "s1", 42);
      expect(snapshotOf(sessions).byId["s1"]).toMatchObject({ updatedAt: 42 });
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("宿主推 `api-session/removed` 时把那一行从 list 移除", async () => {
    const { app, sessions, remote } = await boot();
    try {
      remote.emit("api-session/added", summaryOf("s1"));
      expect(snapshotOf(sessions).ids).toEqual(["s1"]);
      remote.emit("api-session/removed", "s1");
      expect(snapshotOf(sessions).ids).toEqual([]);
      expect(snapshotOf(sessions).byId["s1"]).toBeUndefined();
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("retain 返回上游 `SessionReference` 的形状，且没有子代理地址", async () => {
    const { app, sessions } = await boot();
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
  it("`retain` 后 mainView 为 1，`release` 后回 0，订阅者收到变化", { timeout: 10_000 }, async () => {
    const { app, sessions } = await boot(
      () => ({ ids: ["s1"], byId: { s1: summaryOf("s1") } }),
      undefined,
      { "session/follow": async function* () {} },
    );
    try {
      const info = sessions.retainInfo(SessionId("s1")) as {
        getSnapshot(): { retainedBy?: Record<string, number> };
        subscribe(listener: () => void): () => void;
      };
      let notified = 0;
      info.subscribe(() => { notified += 1; });

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
  });
});

describe("retainInfo：按 source 分开计数", () => {
  it("`sidebarView` 的保留不记到 `mainView` 上（否则主区判断会被顶住）", { timeout: 10_000 }, async () => {
    const { app, sessions } = await boot(
      () => ({ ids: ["s1"], byId: { s1: summaryOf("s1") } }),
      undefined,
      { "session/follow": async function* () {} },
    );
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
  });
});

describe("列表里没有的 id 不产生 binding", () => {
  it("`byId` 残留了不在 `ids` 里的行时，`binding()` 仍返回 `undefined`（`ids` 是权威）", { timeout: 10_000 }, async () => {
    // 宿主返回「`ids` 只有 s1，但 `byId` 多带一行 s2」——这是列表刷新后残留的形态。
    const { sessions } = await boot(
      () => ({ ids: ["s1"], byId: { s1: summaryOf("s1"), s2: summaryOf("s2") } }),
      undefined,
      { "session/follow": async function* () {} },
    );
    await until(() => snapshotOf(sessions).ids.length === 1);

    expect(snapshotOf(sessions).byId["s2"]).toBeDefined();
    // 判据：`binding` 只认 `ids` 里的会话。否则 `ui-session` 的 `publishMain` 会把 s2 当 main，
    // 主区停在一个不存在的会话上（`data-phase="active"` 而不是 `hero`）。
    expect(sessions.binding("s2")).toBeUndefined();
    expect(sessions.binding("s1")).toBeDefined();
  });
});

describe("投影摘要摊平", () => {
  it("宿主行的 `projections.values` 变成客户端行的 `projectionValues`（`restoreBlank` 读它）", { timeout: 10_000 }, async () => {
    const { sessions } = await boot(
      () => ({
        ids: ["s1"],
        byId: {
          s1: {
            ...summaryOf("s1"),
            projections: { kind: "sequenced", asOfSeq: 3, values: { agentPreset: "cordis" } },
          },
        },
      }),
      undefined,
      { "session/follow": async function* () {} },
    );
    await until(() => snapshotOf(sessions).ids.length === 1);
    expect(snapshotOf(sessions).byId["s1"]).toMatchObject({
      projectionValues: { agentPreset: "cordis" },
    });
  });
});
