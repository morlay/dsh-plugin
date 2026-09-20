// @vitest-environment jsdom
// 浏览器半的门控闭环：编辑器动作经 `/session-editor` 打到 host；动作成功后走
// resync + 投影截断（rewind 的删除无法经 append-only 事件流表达）；
// 撤回把该消息的全部文本块回填 composer；刷新只由动作驱动——会话列表 / 快照变化不发请求。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { SessionEditorController } from "../client/controller.ts";
import { SESSION_EDITOR_PATH } from "../shared.ts";

interface FetchCall {
  url: string;
  body: string | undefined;
}

function responseFor(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

function stubFetch(payloads: readonly unknown[]): FetchCall[] {
  const calls: FetchCall[] = [];
  let index = 0;
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body });
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return responseFor(payload);
  });
  return calls;
}

function stubFailure(status: number, payload: unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body });
    return {
      ok: false,
      status,
      json: async () => payload,
    } as unknown as Response;
  });
  return calls;
}

interface FakeSessions {
  list: { subscribe: (listener: () => void) => () => void; getSnapshot: () => unknown };
  binding: (id: string) => unknown;
  scope: (id: string) => unknown;
  refresh?: () => Promise<void>;
}

function fakeSessions(
  ids: readonly string[] = ["s1"],
  capabilities: { resync?: boolean; refresh?: boolean } = {},
): {
  sessions: FakeSessions;
  drafts: string[];
  counts: { refreshes: number; resyncs: number };
  emitList: () => void;
  emitSession: () => void;
} {
  const withResync = capabilities.resync ?? true;
  const withRefresh = capabilities.refresh ?? true;
  const drafts: string[] = [];
  const state = { refreshes: 0, resyncs: 0 };
  const listListeners: Array<() => void> = [];
  const sessionListeners: Array<() => void> = [];
  const byId: Record<string, unknown> = {};
  for (const id of ids) byId[id] = {};
  const sessions: FakeSessions = {
    list: {
      subscribe: (listener: () => void) => {
        listListeners.push(listener);
        return () => {};
      },
      getSnapshot: () => ({ byId }),
    },
    binding: () => ({
      session: {
        subscribe: (listener: () => void) => {
          sessionListeners.push(listener);
          return () => {};
        },
        ...(withResync
          ? {
              resync: async () => {
                state.resyncs += 1;
              },
            }
          : {}),
      },
    }),
    scope: () => ({
      get: () => ({ input: { for: () => ({ restoreDraft: (d: string) => drafts.push(d) }) } }),
    }),
    ...(withRefresh
      ? {
          refresh: async () => {
            state.refreshes += 1;
          },
        }
      : {}),
  };
  return {
    sessions,
    drafts,
    counts: state,
    emitList: () => {
      for (const listener of listListeners) listener();
    },
    emitSession: () => {
      for (const listener of sessionListeners) listener();
    },
  };
}

function controllerWith(sessions: FakeSessions, id = "s1"): SessionEditorController {
  const ctx = { get: () => sessions };
  return new SessionEditorController(ctx as never, id as SessionId);
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

function mutateCalls(calls: readonly FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.body !== undefined);
}

beforeEach(() => {
  delete (globalThis as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__;
});

describe("SessionEditorController（浏览器半）", () => {
  // 动作成功后重建会话窗口（rewind 让客户端窗口的 seq 基线失效），且绝不整页重载。
  it("retry 成功后重建会话窗口，不整页重载", async () => {
    const { sessions, counts } = fakeSessions();
    const controller = controllerWith(sessions);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const calls = stubFetch([{ sessionId: "s1", queuedTurns: 1, live: true }]);

    const applied = await controller.face.retry(2, "truncate");

    expect(applied).toBe(true);
    expect(JSON.parse(mutateCalls(calls)[0]!.body!)).toEqual({
      action: "retry",
      sessionId: "s1",
      turn: 2,
      cascade: "truncate",
    });
    expect(counts.resyncs).toBe(1);
    expect(counts.refreshes).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("没有 resync 时退化为刷列表，仍然不整页重载", async () => {
    const { sessions, counts } = fakeSessions(["s1"], { resync: false });
    const controller = controllerWith(sessions);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    stubFetch([{ sessionId: "s1", queuedTurns: 0 }]);

    expect(await controller.face.recall(userBlock, ["hello"])).toBe(true);

    expect(counts.resyncs).toBe(0);
    expect(counts.refreshes).toBe(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("两条重建入口都没有时不抛错、不整页重载，只记一条 warn", async () => {
    const { sessions, counts } = fakeSessions(["s1"], { resync: false, refresh: false });
    const controller = controllerWith(sessions);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch([{ sessionId: "s1", queuedTurns: 0 }]);

    expect(await controller.face.recall(userBlock, ["hello"])).toBe(true);

    expect(counts.resyncs).toBe(0);
    expect(counts.refreshes).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("recall 回填该消息的全部文本块，且只发一次 recall 请求", async () => {
    const { sessions, drafts } = fakeSessions();
    const controller = controllerWith(sessions);
    const calls = stubFetch([{ sessionId: "s1", queuedTurns: 0 }]);

    const applied = await controller.face.recall(userBlock, ["第一块", "第二块"]);

    expect(applied).toBe(true);
    const posts = mutateCalls(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(SESSION_EDITOR_PATH);
    expect(JSON.parse(posts[0]!.body!)).toEqual({
      action: "recall",
      sessionId: "s1",
      eventSeq: 4,
    });
    expect(drafts).toEqual(["第一块\n\n第二块"]);
  });

  it("失败响应返回 false 且不阻塞下一次操作", async () => {
    const { sessions } = fakeSessions();
    const controller = controllerWith(sessions);
    stubFailure(409, { error: "rewind 目标不是闭合边界" });

    expect(await controller.face.retry(2, "truncate")).toBe(false);

    const calls = stubFetch([{ sessionId: "s1", queuedTurns: 0 }]);
    expect(await controller.face.retry(2, "truncate")).toBe(true);
    expect(mutateCalls(calls)).toHaveLength(1);
  });

  it("会话列表或快照变化不发任何请求（刷新只由动作驱动）", async () => {
    const { sessions, emitList, emitSession } = fakeSessions();
    controllerWith(sessions);
    const calls = stubFetch([{ sessionId: "s1", queuedTurns: 0 }]);

    emitList();
    emitSession();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(0);
  });

  it("上一次操作未落定时不重复提交", async () => {
    const { sessions } = fakeSessions();
    const controller = controllerWith(sessions);
    let release: (() => void) | undefined;
    vi.stubGlobal("fetch", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return responseFor({ sessionId: "s1", queuedTurns: 0 });
    });

    const first = controller.face.recall(userBlock, ["hello"]);
    const second = await controller.face.recall(userBlock, ["hello"]);

    expect(second).toBe(false);
    release?.();
    await first;
  });
});
