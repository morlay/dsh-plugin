// @vitest-environment happy-dom
// 浏览器半的门控闭环：两个动作经 `sessionEditor` 组打到宿主；动作成功后重建该会话的窗口
// （rewind 让客户端窗口的 seq 基线失效），撤回把该消息的全部文本块回填 composer 并把视口送回底部；
// 失败返回 false 且不阻塞下一次；上一次未落定时不重复提交。
import { bootstrapApplication } from "@morlay/zephyr";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { Locale } from "@morlay/zephyr-app/client";
import { Remote } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionEditorStore } from "../session-editor.store.ts";
import { SessionEditorEndpointClient } from "../session-editor-endpoint.client.ts";

interface Invocation {
  endpoint: string;
  args: Readonly<Record<string, unknown>>;
}

// 假 remote：只实现转发要用的 `invoke`，记录每一次端点调用。
function fakeRemote(outcome: () => Promise<unknown>): { remote: unknown; calls: Invocation[] } {
  const calls: Invocation[] = [];
  return {
    calls,
    remote: {
      invoke: async (endpoint: string, args: Readonly<Record<string, unknown>>) => {
        calls.push({ endpoint, args });
        return outcome();
      },
    },
  };
}

// 假会话目录：`binding` 给 resync 入口，`refresh` 记次数，`scope` 给输入面。
function fakeSessions(options: { resync?: boolean } = {}): {
  sessions: unknown;
  drafts: string[];
  counts: { refreshes: number; resyncs: number };
} {
  const drafts: string[] = [];
  const counts = { refreshes: 0, resyncs: 0 };
  const withResync = options.resync ?? true;
  const sessions = {
    binding: () => ({
      session: withResync
        ? {
            resync: async () => {
              counts.resyncs += 1;
            },
          }
        : {},
    }),
    scope: () => ({
      get: () => ({ input: { for: () => ({ setDraft: (draft: string) => drafts.push(draft) }) } }),
    }),
    refresh: async () => {
      counts.refreshes += 1;
    },
  };
  return { sessions, drafts, counts };
}

const localeStub = {
  register: () => () => {},
  bind: () => () => "",
  getSnapshot: () => ({}),
  subscribe: () => () => {},
};

async function storeWith(
  outcome: () => Promise<unknown>,
  sessions: unknown,
): Promise<{ store: SessionEditorStore; calls: Invocation[]; dispose: () => Promise<void> }> {
  const { remote, calls } = fakeRemote(outcome);
  const app = await bootstrapApplication({
    providers: [
      { provide: Remote as never, useValue: remote },
      { provide: SessionController as never, useValue: sessions },
      { provide: Locale as never, useValue: localeStub },
      SessionEditorEndpointClient,
      SessionEditorStore,
    ],
    timeoutMs: 8_000,
  });
  return { store: app.get(SessionEditorStore), calls, dispose: () => app.dispose() };
}

const userBlock = {
  key: "4:0",
  turn: 1,
  eventSeq: 4,
  blockIndex: 0,
  kind: "user",
  text: "hello",
  time: 4,
} as never;

const applied = { ok: true, value: { sessionId: "s1", queuedTurns: 1, live: true } };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SessionEditorStore 的动作闭环", () => {
  it("retry 打到 sessionEditor/retry 并带会话、轮次与级联；成功后重建窗口、不整页重载", async () => {
    const { sessions, counts } = fakeSessions();
    const { store, calls, dispose } = await storeWith(async () => applied, sessions);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    try {
      expect(await store.faceOf("s1").retry(2, "truncate")).toBe(true);
      expect(calls).toEqual([
        {
          endpoint: "sessionEditor/retry",
          args: { request: { sessionId: "s1", turn: 2, cascade: "truncate" } },
        },
      ]);
      expect(counts.resyncs).toBe(1);
      expect(counts.refreshes).toBe(0);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      await dispose();
      vi.unstubAllGlobals();
    }
  });

  it("没有 resync 时退化为刷列表", async () => {
    const { sessions, counts } = fakeSessions({ resync: false });
    const { store, dispose } = await storeWith(async () => applied, sessions);
    try {
      expect(await store.faceOf("s1").retry(2, "truncate")).toBe(true);
      expect(counts.resyncs).toBe(0);
      expect(counts.refreshes).toBe(1);
    } finally {
      await dispose();
    }
  });

  it("recall 只带会话与事件位置，并回填该消息的全部文本块", async () => {
    const { sessions, drafts } = fakeSessions();
    const { store, calls, dispose } = await storeWith(
      async () => ({ ok: true, value: { sessionId: "s1", queuedTurns: 0 } }),
      sessions,
    );
    try {
      expect(await store.faceOf("s1").recall(userBlock, ["第一块", "第二块"])).toBe(true);
      expect(calls).toEqual([
        { endpoint: "sessionEditor/recall", args: { request: { sessionId: "s1", eventSeq: 4 } } },
      ]);
      expect(drafts).toEqual(["第一块\n\n第二块"]);
    } finally {
      await dispose();
    }
  });

  it("失败响应返回 false 且不阻塞下一次操作", async () => {
    let succeed = false;
    const { sessions } = fakeSessions();
    const { store, dispose } = await storeWith(
      async () =>
        succeed
          ? { ok: true, value: { sessionId: "s1", queuedTurns: 0 } }
          : { ok: false, error: { message: "rewind 目标不是闭合边界" } },
      sessions,
    );
    try {
      const face = store.faceOf("s1");
      expect(await face.retry(2, "truncate")).toBe(false);
      succeed = true;
      expect(await face.retry(2, "truncate")).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("上一次操作未落定时不重复提交", async () => {
    const gate = Promise.withResolvers<void>();
    const { sessions } = fakeSessions();
    const { store, calls, dispose } = await storeWith(async () => {
      await gate.promise;
      return applied;
    }, sessions);
    try {
      const face = store.faceOf("s1");
      const first = face.retry(2, "truncate");
      expect(await face.recall(userBlock, ["hello"])).toBe(false);
      gate.resolve();
      expect(await first).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it("fork 打到 sessionEditor/fork 并带会话与消息位置，成功后重建窗口", async () => {
    const { sessions, counts } = fakeSessions();
    const { store, calls, dispose } = await storeWith(
      async () => ({ ok: true, value: { sessionId: "child", queuedTurns: 0 } }),
      sessions,
    );
    try {
      expect(await store.faceOf("s1").fork(8)).toBe(true);
      expect(calls).toEqual([
        { endpoint: "sessionEditor/fork", args: { request: { sessionId: "s1", atSeq: 8 } } },
      ]);
      expect(counts.resyncs).toBe(1);
    } finally {
      await dispose();
    }
  });

  it("同一个会话复用同一个动作面", async () => {
    const { sessions } = fakeSessions();
    const { store, dispose } = await storeWith(async () => applied, sessions);
    try {
      expect(store.faceOf("s1")).toBe(store.faceOf("s1"));
      expect(store.faceOf("s1")).not.toBe(store.faceOf("s2"));
    } finally {
      await dispose();
    }
  });

  it("recall 成功后把会话滚动容器送回底部", async () => {
    const { sessions } = fakeSessions();
    const { store, dispose } = await storeWith(
      async () => ({ ok: true, value: { sessionId: "s1", queuedTurns: 0 } }),
      sessions,
    );
    const port = document.createElement("div");
    port.setAttribute("data-conversation-scroll", "");
    Object.defineProperty(port, "scrollHeight", { value: 640, configurable: true });
    document.body.append(port);
    try {
      expect(await store.faceOf("s1").recall(userBlock, ["hello"])).toBe(true);
      await vi.waitFor(() => {
        expect(port.scrollTop).toBe(640);
      });
    } finally {
      await dispose();
    }
  });
});
