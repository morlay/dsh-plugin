import { runInThisContext } from "node:vm";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortlessWebServer } from "../webserver.ts";
import {
  DESKTOP_STREAM_PATH,
  DESKTOP_TRANSPORT_SCRIPT,
  installDesktopTransport,
  takeOverDesktopAuthentication,
} from "../transport.ts";
import type { IndexInjection } from "@deepseek-ai/dsh-host-webserver";

function harness(): {
  ctx: Context;
  webServer: PortlessWebServer;
  injections: IndexInjection[];
} {
  const ctx = new Context();
  const webServer = new PortlessWebServer(ctx, {});
  const injections: IndexInjection[] = [];
  ctx.on("webserver/index-inject", (table) => {
    injections.push(...table);
  });
  return { ctx, webServer, injections };
}

describe("桌面认证接管", () => {
  it("放行 /api 的请求拒绝与 index 认证", () => {
    const ctx = new Context();
    const calls: string[] = [];
    ctx.provide("connection", {
      requestRejection: () => 401,
      authorizeIndex: () => {
        calls.push("authorize");
        return false;
      },
    });
    takeOverDesktopAuthentication(ctx);
    const connection = ctx.get("connection") as unknown as {
      requestRejection(): number | undefined;
      authorizeIndex(): boolean;
    };
    expect(connection.requestRejection()).toBeUndefined();
    expect(connection.authorizeIndex()).toBe(true);
    expect(calls).toEqual([]);
  });

  it("服务缺失或面改变时大声报错", () => {
    expect(() => takeOverDesktopAuthentication(new Context())).toThrow(/did not provide/);
    const ctx = new Context();
    ctx.provide("connection", {});
    expect(() => takeOverDesktopAuthentication(ctx)).toThrow(/no longer exposes/);
  });
});

describe("桌面 transport 装配", () => {
  it("注入 transport 行并注册 Gateway 流路由", async () => {
    const { ctx, webServer, injections } = harness();
    ctx.provide("typertGateway", {
      wireStream: {
        open: async (endpoint: string) =>
          (async function* () {
            yield { endpoint, seq: 1 };
            yield { endpoint, seq: 2 };
          })(),
      },
    });
    installDesktopTransport(ctx);

    const html = webServer.renderIndex("<html><head></head><body></body></html>");
    expect(html).toContain(DESKTOP_TRANSPORT_SCRIPT);
    expect(injections.some((row) => row.kind === "script")).toBe(false);
    // 侧边栏折叠由上游自己兜住（frame 的 shell.leading 席位在 macOS 收起态恒挂载），
    // 桌面不再注入第二段脚本。
    expect(webServer.collectIndexInjections().filter((row) => row.kind === "script")).toEqual([
      expect.objectContaining({ kind: "script", text: DESKTOP_TRANSPORT_SCRIPT }),
    ]);

    const response = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: "/session.stream", payload: { at: 0 } }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await response.text()).trim().split("\n")).toEqual([
      JSON.stringify({ endpoint: "/session.stream", seq: 1 }),
      JSON.stringify({ endpoint: "/session.stream", seq: 2 }),
    ]);
  });

  it("按 0.1.7 的 wireStream 契约开流：上行项按序进 uplink，peer 是 operator", async () => {
    const { ctx, webServer } = harness();
    const opening: unknown[][] = [];
    ctx.provide("typertGateway", {
      wireStream: {
        open: async (
          endpoint: string,
          payload: unknown,
          uplink: AsyncIterable<unknown>,
          peer: unknown,
          signal: AbortSignal,
        ) => {
          opening.push([endpoint, payload, peer, signal instanceof AbortSignal]);
          return (async function* () {
            for await (const item of uplink) yield { endpoint, item };
          })();
        },
      },
    });
    installDesktopTransport(ctx);

    const response = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: [
          JSON.stringify({ endpoint: "job/attach", payload: { args: { id: "j1" } } }),
          JSON.stringify({ typed: "hello" }),
          JSON.stringify(7),
          "",
        ].join("\n"),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.text()).trim().split("\n")).toEqual([
      JSON.stringify({ endpoint: "job/attach", item: { typed: "hello" } }),
      JSON.stringify({ endpoint: "job/attach", item: 7 }),
    ]);
    expect(opening).toEqual([["job/attach", { args: { id: "j1" } }, undefined, true]]);
  });

  it("非 POST、非法 body 与缺失 gateway 各有明确回应", async () => {
    const { ctx, webServer } = harness();
    installDesktopTransport(ctx);

    const wrongMethod = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid")),
    );
    expect(wrongMethod.status).toBe(405);

    const noGateway = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid"), {
        method: "POST",
        body: JSON.stringify({ endpoint: "/x" }),
      }),
    );
    expect(noGateway.status).toBe(503);

    ctx.provide("typertGateway", { wireStream: { open: async () => [] } });
    const badBody = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid"), {
        method: "POST",
        body: "not json",
      }),
    );
    expect(badBody.status).toBe(400);

    const missingEndpoint = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid"), {
        method: "POST",
        body: JSON.stringify({ payload: {} }),
      }),
    );
    expect(missingEndpoint.status).toBe(400);
  });

  it("Gateway 打不开流时在未写头前回 502", async () => {
    const { ctx, webServer } = harness();
    ctx.provide("typertGateway", {
      wireStream: {
        open: async () => {
          throw new Error("no such endpoint");
        },
      },
    });
    installDesktopTransport(ctx);
    const response = await webServer.dispatch(
      new Request(new URL(DESKTOP_STREAM_PATH, "http://app.invalid"), {
        method: "POST",
        body: JSON.stringify({ endpoint: "/missing" }),
      }),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("no such endpoint");
  });
});

interface StreamCarrierHandlers {
  chunk(text: string): void;
  end(): void;
  fail(message: string): void;
}

interface FakeCarrier {
  handlers: StreamCarrierHandlers | undefined;
  cancels: number;
  /** 经载体发出的上行项。 */
  sent: unknown[];
  ends: number;
}

interface PageTransport {
  openStream(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    uplink?: AsyncIterable<unknown>,
  ): AsyncIterable<unknown>;
}

/** 执行注入脚本并取回页面侧 transport：脚本只写 globalThis，node 环境下可直接跑。 */
function pageTransport(): { transport: PageTransport; carrier: FakeCarrier } {
  const carrier: FakeCarrier = { handlers: undefined, cancels: 0, sent: [], ends: 0 };
  (globalThis as { __DSH_DESKTOP_STREAM__?: unknown }).__DSH_DESKTOP_STREAM__ = {
    open: (_endpoint: string, _payload: unknown, handlers: StreamCarrierHandlers) => {
      carrier.handlers = handlers;
      return {
        cancel: () => {
          carrier.cancels += 1;
        },
        send: (item: unknown) => {
          carrier.sent.push(item);
        },
        end: () => {
          carrier.ends += 1;
        },
      };
    },
  };
  // 脚本与迭代期都会 console.info：spy 一直留到用例结束（afterEach 里 restore）。
  vi.spyOn(console, "info").mockImplementation(() => {});
  runInThisContext(DESKTOP_TRANSPORT_SCRIPT);
  const transport = (globalThis as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__ as
    | PageTransport
    | undefined;
  if (transport === undefined) throw new Error("injected transport script did not install");
  return { transport, carrier };
}

const UNRESOLVED = Symbol("unresolved");

/** 限时等待一次迭代：挂住时给出 UNRESOLVED，而不是让用例挂死。 */
async function settled<T>(promise: Promise<T>, ms = 200): Promise<T | typeof UNRESOLVED> {
  return Promise.race([
    promise,
    new Promise<typeof UNRESOLVED>((resolve) => {
      setTimeout(() => {
        resolve(UNRESOLVED);
      }, ms);
    }),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__;
  delete (globalThis as { __DSH_DESKTOP_STREAM__?: unknown }).__DSH_DESKTOP_STREAM__;
});

describe("页面侧流载体的取消语义", () => {
  it("signal abort 后立即结束迭代——窗口重建（resync）在 await 它的 dispose", async () => {
    const { transport, carrier } = pageTransport();
    const abort = new AbortController();
    const iterator = transport
      .openStream("/session.follow", {}, abort.signal)
      [Symbol.asyncIterator]();

    const pending = iterator.next();
    abort.abort(new Error("disposed"));

    expect(await settled(pending)).toEqual({ done: true, value: undefined });
    expect(carrier.cancels).toBe(1);
  });

  it("signal abort 后 iterator.return() 立即落定——上游 RemoteStream.dispose 等的是它", async () => {
    const { transport } = pageTransport();
    const abort = new AbortController();
    const iterator = transport
      .openStream("/session.follow", {}, abort.signal)
      [Symbol.asyncIterator]();

    const pending = iterator.next();
    abort.abort(new Error("disposed"));

    expect(await settled(iterator.return!(undefined))).toEqual({ done: true, value: undefined });
    await settled(pending);
  });

  it("signal 已经 abort 时消费即结束", async () => {
    const { transport } = pageTransport();
    const abort = new AbortController();
    abort.abort(new Error("disposed"));
    const iterator = transport
      .openStream("/session.follow", {}, abort.signal)
      [Symbol.asyncIterator]();

    expect(await settled(iterator.next())).toEqual({ done: true, value: undefined });
  });

  it("end 帧交付已收数据后结束迭代", async () => {
    const { transport, carrier } = pageTransport();
    const iterator = transport
      .openStream("/session.follow", {}, new AbortController().signal)
      [Symbol.asyncIterator]();

    const first = iterator.next();
    carrier.handlers?.chunk('{"frame":1}\n');
    expect(await settled(first)).toEqual({ done: false, value: { frame: 1 } });

    const second = iterator.next();
    carrier.handlers?.end();
    expect(await settled(second)).toEqual({ done: true, value: undefined });
  });
});

describe("页面侧流载体的上行", () => {
  it("uplink 项逐条交给载体，迭代完就结束请求体", async () => {
    const { transport, carrier } = pageTransport();
    const uplink = (async function* (): AsyncGenerator<unknown> {
      yield { typed: "a" };
      yield 7;
    })();
    const iterator = transport
      .openStream("/job/attach", { args: {} }, new AbortController().signal, uplink)
      [Symbol.asyncIterator]();

    const pending = iterator.next();
    await vi.waitFor(() => {
      expect(carrier.sent).toEqual([{ typed: "a" }, 7]);
    });
    expect(carrier.ends).toBe(1);
    carrier.handlers?.end();
    expect(await settled(pending)).toEqual({ done: true, value: undefined });
  });

  it("没有 uplink 的流立刻结束请求体：宿主不必等一个永不来的 end", async () => {
    const { transport, carrier } = pageTransport();
    const iterator = transport
      .openStream("/$events", { args: {} }, new AbortController().signal)
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await vi.waitFor(() => {
      expect(carrier.ends).toBe(1);
    });
    expect(carrier.sent).toEqual([]);
    carrier.handlers?.end();
    expect(await settled(pending)).toEqual({ done: true, value: undefined });
  });

  it("abort 后不再发上行项", async () => {
    const { transport, carrier } = pageTransport();
    const abort = new AbortController();
    let push: ((item: unknown) => void) | undefined;
    const uplink: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<unknown>>((resolve) => {
            push = (item) => {
              resolve({ done: false, value: item });
            };
          }),
        return: () => Promise.resolve({ done: true, value: undefined }),
      }),
    };
    const iterator = transport
      .openStream("/job/attach", {}, abort.signal, uplink)
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await vi.waitFor(() => {
      expect(push).toBeDefined();
    });
    push?.({ typed: "before" });
    await vi.waitFor(() => {
      expect(carrier.sent).toEqual([{ typed: "before" }]);
    });
    abort.abort(new Error("disposed"));
    expect(await settled(pending)).toEqual({ done: true, value: undefined });
    expect(carrier.cancels).toBe(1);
    // 取消后即使上行迭代又交付一项，也不再发给宿主。
    push?.({ typed: "after" });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(carrier.sent).toEqual([{ typed: "before" }]);
  });
});
