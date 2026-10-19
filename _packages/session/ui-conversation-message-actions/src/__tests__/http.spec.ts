import { WebServer } from "@morlay/dsh-base/web-server";
import { Agents } from "@morlay/dsh-base/agent";
import { describe, expect, it } from "vitest";
import {
  createPersisted,
  harness,
  meta,
  SessionIdBrand,
  SESSION_EDITOR_PATHS,
  twoTurnLog } from "../testing.ts";

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

function fakeJsonRequest(body: unknown): FakeRequest {
  const chunk = Buffer.from(JSON.stringify(body));
  const request: FakeRequest = {
    method: "POST",
    url: SESSION_EDITOR_PATHS.edit,
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

describe("session-editor HTTP 面", () => {
  it("stops the running live agent's loop before a rewind action truncates", async () => {
    const routes = new Map<string, RouteHandler>();
    const agentMap = new Map<string, unknown>();
    const { ctx, sessions, persistence, logger, dispose } = await harness([
      {
        provide: WebServer,
        useFactory: () => ({
          register: (route: { path: string; handler: RouteHandler }) => {
            routes.set(route.path, route.handler);
            return () => {};
          },
        }),
      },
      { provide: Agents, useFactory: () => ({ get: (id: string) => agentMap.get(id) }) },
    ]);
    try {
      for (let i = 0; i < 1000 && !routes.has(SESSION_EDITOR_PATHS.edit); i += 1)
        await Promise.resolve();
      expect(Object.values(SESSION_EDITOR_PATHS).every((path) => routes.has(path))).toBe(true);

      sessions.create(SessionIdBrand("busy"), {
        meta: meta("busy"),
        seed: [...twoTurnLog()],
      });
      const live = sessions.get(SessionIdBrand("busy"))!;
      await sessions.flush(live);
      const before = live.snapshotEvents().length;

      const calls: string[] = [];
      const cancels: Array<{ cause: unknown; options: unknown }> = [];
      agentMap.set("busy", {
        session: live,
        followup: () => {},
        cancel: (cause: unknown, options: unknown) => {
          calls.push("cancel");
          cancels.push({ cause, options });
        },
        whenIdle: async () => {
          calls.push("whenIdle");
          expect(live.snapshotEvents()).toHaveLength(before);
        },
      });

      const response = fakeResponse();
      await routes.get(SESSION_EDITOR_PATHS.rewind)!(
        fakeJsonRequest({ sessionId: "busy", toBoundary: 5 }),
        response.response,
      );

      expect(response.code).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ sessionId: "busy", queuedTurns: 0 });

      expect(calls).toEqual(["cancel", "whenIdle"]);
      expect(cancels[0]).toEqual({ cause: { kind: "user" }, options: { keepInbox: true } });
      expect(live.snapshotEvents().map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    } finally {
      await dispose();
    }
  });

  it("GET 不服务（405），缺参数 400", async () => {
    const routes = new Map<string, RouteHandler>();
    const { ctx, sessions, persistence, logger, dispose } = await harness([
      {
        provide: WebServer,
        useFactory: () => ({
          register: (route: { path: string; handler: RouteHandler }) => {
            routes.set(route.path, route.handler);
            return () => {};
          },
        }),
      },
    ]);
    try {
      for (let i = 0; i < 1000 && !routes.has(SESSION_EDITOR_PATHS.recall); i += 1)
        await Promise.resolve();
      const handler = routes.get(SESSION_EDITOR_PATHS.recall)!;
      await createPersisted(persistence, "s1", twoTurnLog());

      const listed = fakeResponse();
      const request: FakeRequest = {
        method: "GET",
        url: `${SESSION_EDITOR_PATHS.recall}?sessionId=s1`,
        on() {
          return request;
        },
      };
      await handler(request, listed.response);
      expect(listed.code).toBe(405);

      const rejected = fakeResponse();
      await handler(fakeJsonRequest({}), rejected.response);
      expect(rejected.code).toBe(400);
    } finally {
      await dispose();
    }
  });
});
