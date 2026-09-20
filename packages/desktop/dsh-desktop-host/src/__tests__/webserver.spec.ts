import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { PortlessWebServer } from "../webserver.ts";
import type { IndexInjection } from "@deepseek-ai/dsh-host-webserver";

function server(): { ctx: Context; webServer: PortlessWebServer } {
  const ctx = new Context();
  const webServer = new PortlessWebServer(ctx, {});
  return { ctx, webServer };
}

function get(path: string): Request {
  return new Request(new URL(path, "http://app.invalid"));
}

describe("无端口 webServer", () => {
  it("按 exact、最长前缀、fallback 的顺序分派", async () => {
    const { webServer } = server();
    webServer.register({
      kind: "prefix",
      path: "/api",
      handler: (_req, res) => {
        res.writeHead(200).end("api");
      },
    });
    webServer.register({
      kind: "prefix",
      path: "/api/session",
      handler: (_req, res) => {
        res.writeHead(200).end("session");
      },
    });
    webServer.register({
      kind: "exact",
      path: "/api/session-editor",
      handler: (_req, res) => {
        res.writeHead(200).end("editor");
      },
    });
    webServer.registerFallback((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" }).end("index");
    });

    expect(await (await webServer.dispatch(get("/api/session-editor"))).text()).toBe("editor");
    expect(await (await webServer.dispatch(get("/api/session/list"))).text()).toBe("session");
    expect(await (await webServer.dispatch(get("/api/other"))).text()).toBe("api");
    expect(await (await webServer.dispatch(get("/assets/app.js"))).text()).toBe("index");
  });

  it("没有匹配也没有 fallback 时回 404", async () => {
    const { webServer } = server();
    const response = await webServer.dispatch(get("/missing"));
    expect(response.status).toBe(404);
  });

  it("把状态、头与流式响应体交给调用方", async () => {
    const { webServer } = server();
    webServer.register({
      kind: "exact",
      path: "/stream",
      handler: (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("one\n");
        setTimeout(() => {
          res.write("two\n");
          res.end();
        }, 1);
      },
    });
    const response = await webServer.dispatch(get("/stream"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("one\ntwo\n");
  });

  it("把请求体交给 handler，并保留方法、路径与头", async () => {
    const { webServer } = server();
    webServer.register({
      kind: "exact",
      path: "/echo",
      handler: async (req, res) => {
        let body = "";
        for await (const chunk of req) body += Buffer.from(chunk as Buffer).toString("utf8");
        res.writeHead(201, { "x-method": req.method ?? "" });
        res.end(`${req.url}|${String(req.headers["x-probe"])}|${body}`);
      },
    });
    const response = await webServer.dispatch(
      new Request(new URL("/echo?limit=2", "http://app.invalid"), {
        method: "POST",
        headers: { "x-probe": "yes" },
        body: "payload",
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-method")).toBe("POST");
    expect(await response.text()).toBe("/echo?limit=2|yes|payload");
  });

  it("handler 未写头就抛错时回 500，写头后抛错则中断响应体", async () => {
    const { webServer } = server();
    webServer.register({
      kind: "exact",
      path: "/boom",
      handler: () => {
        throw new Error("handler exploded");
      },
    });
    webServer.register({
      kind: "exact",
      path: "/boom-late",
      handler: (_req, res) => {
        res.writeHead(200);
        res.write("partial");
        throw new Error("after headers");
      },
    });
    const early = await webServer.dispatch(get("/boom"));
    expect(early.status).toBe(500);
    expect(await early.text()).toBe("handler exploded");

    const late = await webServer.dispatch(get("/boom-late"));
    expect(late.status).toBe(200);
    await expect(late.text()).rejects.toThrow("after headers");
  });

  it("index 渲染收集注入行并按注册顺序应用 tap", async () => {
    const { ctx, webServer } = server();
    const seen: IndexInjection[][] = [];
    ctx.on("webserver/index-inject", (table) => {
      seen.push([...table]);
      table.push({ kind: "global", name: "__DSH_PROBE__", value: 1 });
    });
    webServer.tapIndex((html) => `${html}<!-- tapped -->`);

    expect(webServer.collectIndexInjections()).toEqual([
      { kind: "global", name: "__DSH_PROBE__", value: 1 },
    ]);
    const html = webServer.renderIndex("<html><head></head><body></body></html>");
    expect(seen).toHaveLength(2);
    expect(html).toContain('globalThis["__DSH_PROBE__"] = 1');
    expect(html).toContain("__DSH_BOOT_READY__");
    expect(html.endsWith("<!-- tapped -->")).toBe(true);
  });

  it("端口只是展示值，host 固定为回环", async () => {
    const { webServer } = server();
    expect(webServer.port).toBe(0);
    expect(webServer.host).toBe("127.0.0.1");
  });

  it("重复注册同名路由或 fallback 会抛错", () => {
    const { webServer } = server();
    webServer.register({ kind: "exact", path: "/dup", handler: () => {} });
    expect(() => webServer.register({ kind: "exact", path: "/dup", handler: () => {} })).toThrow(
      /duplicate exact route/,
    );
    webServer.registerFallback(() => {});
    expect(() => webServer.registerFallback(() => {})).toThrow(/fallback already registered/);
  });

  it("注册的 disposer 会移除路由", async () => {
    const { webServer } = server();
    const dispose = webServer.register({
      kind: "exact",
      path: "/gone",
      handler: (_req, res) => {
        res.writeHead(200).end("here");
      },
    });
    dispose();
    expect((await webServer.dispatch(get("/gone"))).status).toBe(404);
  });
});
