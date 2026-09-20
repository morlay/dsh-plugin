import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
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
