// @vitest-environment happy-dom
// 装配面守护：浏览器半的装配函数装出两件事——两条 chat-node 渲染注册到 `conversation.chat.node`，
// 管理页的 main 面板与 nav 行按同一个 id 成对注册。
//
// 只装本面 + 最小的槽位宿主（`provideRenderer`），不引上游 client 行：那批产物是浏览器模块工厂，
// node 侧加载不了。
import { bootstrapApplication } from "@morlay/zephyr";
import { provideRenderer, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import { Locale, Remote } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { provideBetterSessionUi } from "../better-session.provide.ts";

const remoteStub = {
  invoke: async () => ({ ok: true, value: { sessionId: "s1", queuedTurns: 0 } }),
};

const sessionsStub = {
  refresh: async () => undefined,
  binding: () => undefined,
  scope: () => undefined,
};

const workspaceStub = {
  archiveSession: async () => undefined,
  unarchiveSession: async () => undefined,
};

// 字典面：本包在视图 `onInit` 里注册两份字典，这里只记下注册过的 namespace。
const registered: string[] = [];
const localeStub = {
  register: (ns: string) => {
    registered.push(ns);
    return () => {};
  },
  bind: () => (key: string) => key,
  getSnapshot: () => ({ revision: 0 }),
  subscribe: () => () => {},
};

describe("浏览器半的装配面", () => {
  it("装出两条 chat-node 注册与一对 main / sidebar.panellist 注册", async () => {
    const app = await bootstrapApplication({
      providers: [
        ...provideRenderer(),
        { provide: Remote as never, useValue: remoteStub },
        { provide: SessionController as never, useValue: sessionsStub },
        { provide: UiWorkspace as never, useValue: workspaceStub },
        { provide: Locale as never, useValue: localeStub },
        ...provideBetterSessionUi(),
      ],
      timeoutMs: 8_000,
    });
    const slots = app.get(Slots);
    try {
      // 位置由上游声明：这里按生产的 children 表形状先声明出来（`ui-chat` / `ui-layout` 在生产里给）。
      slots.registerDynamic(
        {
          name: "root",
          children: {
            "conversation.chat.node": { kind: "keyed", scope: "session" },
            main: { kind: "keyed", scope: "root" },
            "sidebar.panellist": { kind: "list", scope: "root" },
          },
        },
        () => null,
      );
      await Promise.resolve();

      // 覆盖官方那两条：priority -1（lowest renders，我们这份生效）、locale 与行一致、inject 面在场。
      const nodes = slots.entries("conversation.chat.node");
      expect(nodes.map((entry) => entry.options.key)).toEqual(["user", "steering"]);
      for (const entry of nodes) {
        expect(entry.options.priority).toBe(-1);
        expect(entry.locale).toBe("chat");
        expect(typeof entry.inject).toBe("function");
      }

      // nav 行与主面板同一个 id：layout 点 nav 行时要能在 main 里找到这个 key。
      expect(slots.entries("main").map((entry) => entry.options.key)).toEqual(["conversations"]);
      const rows = slots.entriesOfSlot("sidebar.panellist");
      expect(rows.map((entry) => entry.options.id)).toEqual(["conversations"]);
      expect(rows[0]?.options.order).toBe(1);
      // nav 行标签来自本包字典（`panel` 键），与页面标题同一个绑定。
      expect(rows[0]?.options.label).toBeTypeOf("function");
      // 每个字典 namespace 只注册一次：上游对同一 namespace + locale 二次注册会抛。
      // 这里是**第二个 i18n namespace**（页面文案 / 消息动作行文案各一份），不是新增 slot 注册：
      // 上面 chat-node 的两条 keyed 注册数与 main / sidebar.panellist 的成对注册都没变。
      expect(registered).toEqual(["conversationManager", "sessionEditor"]);
    } finally {
      await app.dispose();
    }
  });
});
