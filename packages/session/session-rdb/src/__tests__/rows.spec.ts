import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { SessionId, SessionSeq, SessionStore } from "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SessionPersistenceSqlite, { SESSION_ROWS_PATH } from "@morlay/session-rdb";
import { meta, oneTurnLog } from "@morlay/session-rdb/testing";

/**
 * 管理面的会话行路由（`/api/session.rows`）：**完整语料（含归档）** + 标题 + 最后活动时间。
 *
 * 它与官方 `session/list` 是两条路：后者按部署策略默认排除归档（见 `session-query.spec.ts` 的
 * 「excludes archived sessions from the official list」），这里给的是管理动作需要的完整集合。
 */

interface FakeResponse {
  res: import("node:http").ServerResponse;
  code: number;
  body: string;
}

function fakeResponse(): FakeResponse {
  const state = {
    res: undefined as unknown as import("node:http").ServerResponse,
    code: 0,
    body: "",
  };
  state.res = {
    writeHead: (code: number) => {
      state.code = code;
      return state.res;
    },
    end: (chunk?: string) => {
      if (chunk !== undefined) state.body = chunk;
    },
  } as unknown as import("node:http").ServerResponse;
  return state;
}

function fakeRequest(method = "POST", body: unknown = {}): import("node:http").IncomingMessage {
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  } as unknown as import("node:http").IncomingMessage;
}

/** 标题事件必须紧接在已有日志之后（seq 连续）；`time` 决定「最后活动时间」的先后。 */
function titled(
  log: readonly SessionEvent[],
  title: string,
  time = log.length + 1,
): SessionEvent[] {
  return [
    ...log,
    {
      type: "session/title",
      seq: SessionSeq(log.length),
      time,
      data: { title, messageSeqs: [], source: "auto" },
    } as unknown as SessionEvent,
  ];
}

async function harness(): Promise<{
  ctx: Context;
  call: (
    method?: string,
    body?: Record<string, unknown>,
  ) => Promise<{ code: number; items: Array<Record<string, unknown>>; total?: number }>;
  dispose: () => Promise<void>;
}> {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  new SessionProjectionRegistry(ctx);
  const fiber = await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: ":memory:" });
  const routes = new Map<string, (req: unknown, res: unknown) => void | Promise<void>>();
  ctx.provide("webServer", {
    register: (route: {
      path: string;
      handler: (req: unknown, res: unknown) => void | Promise<void>;
    }) => {
      routes.set(route.path, route.handler);
      return () => {};
    },
  } as never);
  ctx.provide("connection", { requestRejection: () => undefined } as never);
  for (let i = 0; i < 1000 && !routes.has(SESSION_ROWS_PATH); i += 1) await Promise.resolve();
  const handler = routes.get(SESSION_ROWS_PATH);
  if (handler === undefined) throw new Error("session rows route was not registered");
  return {
    ctx,
    call: async (method = "POST", body = {}) => {
      const response = fakeResponse();
      await handler(fakeRequest(method, body), response.res);
      const parsed =
        response.body === "" ? {} : (JSON.parse(response.body) as { items?: []; total?: number });
      return {
        code: response.code,
        items: parsed.items ?? [],
        ...(parsed.total === undefined ? {} : { total: parsed.total }),
      };
    },
    dispose: () => fiber.dispose(),
  };
}

describe("session-rdb session rows route", () => {
  const disposals: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const dispose of disposals.splice(0)) await dispose();
  });

  it("returns the complete corpus, including archived sessions, with titles", async () => {
    const { ctx, call, dispose } = await harness();
    disposals.push(dispose);
    const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
    await persistence.createAndAppend(meta("kept"), titled(oneTurnLog(), "留下的会话"));
    await persistence.createAndAppend(
      { ...meta("archived"), origin: "subagent" },
      titled(oneTurnLog(), "归档的子代理"),
    );
    const persistenceRdb = persistence as unknown as {
      internals(): {
        backend: {
          storage: {
            writeWorkspaceState(state: {
              initialized: boolean;
              workspaceIds: readonly string[];
              archivedSessionIds: readonly SessionId[];
              pinnedSessionIds: readonly string[];
            }): Promise<void>;
          };
        };
      };
    };
    await persistenceRdb.internals().backend.storage.writeWorkspaceState({
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: [SessionId("archived")],
      pinnedSessionIds: [],
    });

    // 完整语料：连子代理派生会话一起要（默认不含，见分页/搜索那条用例）。
    const value = await call("POST", { includeSubagents: true });

    expect(value.code).toBe(200);
    expect(value.total).toBe(2);
    const byId = new Map(value.items.map((item) => [String(item["sessionId"]), item]));
    // 两条都在：管理面要的就是完整集合（官方那条会把 archived 过滤掉）。
    expect([...byId.keys()].sort()).toEqual(["archived", "kept"]);
    expect(byId.get("kept")).toMatchObject({
      title: "留下的会话",
      archived: false,
      origin: null,
    });
    expect(byId.get("archived")).toMatchObject({
      title: "归档的子代理",
      archived: true,
      origin: "subagent",
    });
  });

  it("orders by last activity and never reports an earlier time than creation", async () => {
    const { ctx, call, dispose } = await harness();
    disposals.push(dispose);
    const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
    // 事件时间要晚于创建时间（meta 的 createdAt = 1000），否则「最后活动」会被创建时间兜底。
    await persistence.createAndAppend(meta("older"), titled(oneTurnLog(), "旧的", 1100));
    await persistence.createAndAppend(meta("newer"), titled(oneTurnLog(), "新的", 1200));

    const value = await call();

    expect(value.items.map((item) => String(item["sessionId"]))).toEqual(["newer", "older"]);
    for (const item of value.items) {
      expect(typeof item["updatedAt"]).toBe("number");
      expect(item["updatedAt"] as number).toBeGreaterThanOrEqual(item["createdAt"] as number);
    }
  });

  it("pages and searches on the backend", async () => {
    const { ctx, call, dispose } = await harness();
    disposals.push(dispose);
    const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
    await persistence.createAndAppend(meta("alpha"), titled(oneTurnLog(), "配置 Ollama", 1100));
    await persistence.createAndAppend(meta("beta"), titled(oneTurnLog(), "整理文档", 1200));
    await persistence.createAndAppend(
      { ...meta("child"), origin: "subagent" },
      titled(oneTurnLog(), "子代理的活", 1300),
    );

    // 默认分页 20、默认不含子代理：总数是过滤后的，前端据此算页数。
    const first = await call("POST", { page: 1, pageSize: 1 });
    expect(first.code).toBe(200);
    expect(first.items.map((item) => String(item["sessionId"]))).toEqual(["beta"]);
    expect(first.total).toBe(2);

    const second = await call("POST", { page: 2, pageSize: 1 });
    expect(second.items.map((item) => String(item["sessionId"]))).toEqual(["alpha"]);

    const searched = await call("POST", { query: "文档" });
    expect(searched.items.map((item) => String(item["sessionId"]))).toEqual(["beta"]);
    expect(searched.total).toBe(1);

    const withSubagents = await call("POST", { includeSubagents: true });
    expect(withSubagents.total).toBe(3);
  });

  it("rejects non-POST methods with 405", async () => {
    const { call, dispose } = await harness();
    disposals.push(dispose);
    const value = await call("GET");
    expect(value.code).toBe(405);
    expect(value.items).toEqual([]);
  });
});
