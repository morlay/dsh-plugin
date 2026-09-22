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
        open: async function* (endpoint: string) {
          yield { endpoint, seq: 1 };
          yield { endpoint, seq: 2 };
        },
      },
    });
    installDesktopTransport(ctx);

    const html = webServer.renderIndex("<html><head></head><body></body></html>");
    expect(html).toContain(DESKTOP_TRANSPORT_SCRIPT);
    expect(injections.some((row) => row.kind === "script")).toBe(false);
    expect(webServer.collectIndexInjections().some((row) => row.kind === "script")).toBe(true);

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
}

interface PageTransport {
  openStream(endpoint: string, payload: unknown, signal: AbortSignal): AsyncIterable<unknown>;
}

/** 执行注入脚本并取回页面侧 transport：脚本只写 globalThis，node 环境下可直接跑。 */
function pageTransport(): { transport: PageTransport; carrier: FakeCarrier } {
  const carrier: FakeCarrier = { handlers: undefined, cancels: 0 };
  (globalThis as { __DSH_DESKTOP_STREAM__?: unknown }).__DSH_DESKTOP_STREAM__ = {
    open: (_endpoint: string, _payload: unknown, handlers: StreamCarrierHandlers) => {
      carrier.handlers = handlers;
      return () => {
        carrier.cancels += 1;
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
