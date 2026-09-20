// webServer 面的传输闭环：桌面形态下宿主内接管 webServer（无端口替身），插件只往它上面注册
// 一条 `/session-editor` 的 exact 路由——POST 分发六种动作，参数错误 400、编排冲突 409、
// 方法不允许 405；不再往 connection 服务的 /api 前缀面注册重复路由。
import { describe, expect, it } from "vitest";
import {
  createPersisted,
  harness,
  SessionIdBrand,
  SESSION_EDITOR_PATH,
  twoTurnLog,
} from "@morlay/ui-conversation-message-actions/testing";
import {
  closedTurns,
  editableMessages,
} from "@morlay/ui-conversation-message-actions/plan";

interface FakeRequest {
  method?: string;
  url?: string;
  on(event: string, listener: (arg?: unknown) => void): FakeRequest;
}

interface FakeResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(body?: string): void;
}

type RouteHandler = (request: FakeRequest, response: FakeResponse) => void | Promise<void>;

interface RegisteredRoute {
  kind: string;
  path: string;
  handler: RouteHandler;
}

async function harnessWithRoutes(): Promise<{
  registered: RegisteredRoute[];
  connectionRegistrations: string[];
  ctx: Awaited<ReturnType<typeof harness>>["ctx"];
  editor: Awaited<ReturnType<typeof harness>>["editor"];
  handler: () => RouteHandler;
  dispose: () => Promise<void>;
}> {
  const registered: RegisteredRoute[] = [];
  const connectionRegistrations: string[] = [];
  const { ctx, editor, dispose } = await harness((scope) => {
    scope.provide("webServer", {
      register: (route: RegisteredRoute) => {
        registered.push(route);
        return () => {};
      },
    });
    // 假 connection 服务只用来盯住被删掉的那条重复注册：正常情况下一个调用都不该有
    scope.provide("connection", {
      fetch: {
        register: (route: { path: string }) => {
          connectionRegistrations.push(route.path);
          return async () => {};
        },
      },
    });
  });
  for (let i = 0; i < 1000 && registered.length === 0; i += 1) await Promise.resolve();
  return {
    registered,
    connectionRegistrations,
    ctx,
    editor,
    handler: () => {
      const route = registered.find((item) => item.path === SESSION_EDITOR_PATH);
      if (route === undefined) throw new Error("webServer 上没有注册 session-editor 路由");
      return route.handler;
    },
    dispose,
  };
}

function withoutBody(method: string, url: string): FakeRequest {
  const request: FakeRequest = {
    method,
    url,
    on() {
      return request;
    },
  };
  return request;
}

function postRequest(body: unknown): FakeRequest {
  const chunk = Buffer.from(JSON.stringify(body));
  const request: FakeRequest = {
    method: "POST",
    url: SESSION_EDITOR_PATH,
    on(event, listener) {
      if (event === "data") queueMicrotask(() => listener(chunk));
      if (event === "end") queueMicrotask(() => listener());
      return request;
    },
  };
  return request;
}

function fakeResponse(): { response: FakeResponse; code: number; body: string } {
  const state = {
    response: undefined as unknown as FakeResponse,
    code: 0,
    body: "",
  };
  state.response = {
    writeHead: (status: number) => {
      state.code = status;
      return state.response;
    },
    end: (body?: string) => {
      if (body !== undefined) state.body = body;
    },
  };
  return state;
}

describe("session-editor 的 webServer 路由", () => {
  it("只在 webServer 上注册 exact 路由，不再往 connection 服务重复注册 /api 面", async () => {
    const { registered, connectionRegistrations, dispose } = await harnessWithRoutes();
    try {
      // 别的插件（session-rdb）也会往 webServer 注册，这里只看 session-editor 自己那条
      const ours = registered.filter((route) => route.path === SESSION_EDITOR_PATH);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({ kind: "exact", path: SESSION_EDITOR_PATH });
      // 被删掉的 /api 前缀面：`/api/session-editor` 不该再出现在任何注册面上
      expect(registered.map((route) => route.path)).not.toContain(`/api${SESSION_EDITOR_PATH}`);
      expect(connectionRegistrations).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("POST edit 就地截断（无 agents 时不重放，会话 id 不变，也不再落版本效果）", async () => {
    const { handler, ctx, dispose } = await harnessWithRoutes();
    try {
      await createPersisted(ctx, "s1", twoTurnLog());
      const edited = fakeResponse();
      await handler()(
        postRequest({
          action: "edit",
          sessionId: "s1",
          eventSeq: 1,
          blockIndex: 0,
          text: "edited",
          cascade: "truncate",
        }),
        edited.response,
      );

      expect(edited.code).toBe(200);
      expect(JSON.parse(edited.body)).toEqual({ sessionId: "s1", queuedTurns: 0, live: false });

      const handle = await ctx.sessionPersistence.open(SessionIdBrand("s1"), "read");
      const { events } = await handle.read();
      await handle.close();
      expect(events).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("POST recall 只截断、不重放（被撤回的轮次及其后内容消失）", async () => {
    const { handler, ctx, dispose } = await harnessWithRoutes();
    try {
      await createPersisted(ctx, "s1", twoTurnLog());
      const recalled = fakeResponse();
      await handler()(
        postRequest({ action: "recall", sessionId: "s1", eventSeq: 7 }),
        recalled.response,
      );

      expect(recalled.code).toBe(200);
      expect(JSON.parse(recalled.body)).toEqual({ sessionId: "s1", queuedTurns: 0, live: false });

      const handle = await ctx.sessionPersistence.open(SessionIdBrand("s1"), "read");
      const { events } = await handle.read();
      await handle.close();
      const messages = editableMessages(closedTurns([...events]));
      expect(messages.map((row) => row.text)).toEqual(["hi", "hello"]);
    } finally {
      await dispose();
    }
  });

  it("未知 action 与缺参数都是 400", async () => {
    const { handler, dispose } = await harnessWithRoutes();
    try {
      const unknown = fakeResponse();
      await handler()(postRequest({ action: "explode", sessionId: "s1" }), unknown.response);
      expect(unknown.code).toBe(400);
      expect(JSON.parse(unknown.body)).toMatchObject({
        error: expect.stringContaining("action"),
      });

      const missing = fakeResponse();
      await handler()(postRequest({ action: "reroll" }), missing.response);
      expect(missing.code).toBe(400);
    } finally {
      await dispose();
    }
  });

  it("编排冲突（越界 eventSeq）是 409", async () => {
    const { handler, ctx, dispose } = await harnessWithRoutes();
    try {
      await createPersisted(ctx, "s1", twoTurnLog());
      const conflicted = fakeResponse();
      await handler()(
        postRequest({
          action: "edit",
          sessionId: "s1",
          eventSeq: 9_999,
          blockIndex: 0,
          text: "x",
          cascade: "truncate",
        }),
        conflicted.response,
      );
      expect(conflicted.code).toBe(409);
      expect(JSON.parse(conflicted.body)).toMatchObject({ error: expect.any(String) });
    } finally {
      await dispose();
    }
  });

  it("不支持的方法返回 405", async () => {
    const { handler, dispose } = await harnessWithRoutes();
    try {
      const rejected = fakeResponse();
      await handler()(withoutBody("DELETE", SESSION_EDITOR_PATH), rejected.response);
      expect(rejected.code).toBe(405);
    } finally {
      await dispose();
    }
  });
});
