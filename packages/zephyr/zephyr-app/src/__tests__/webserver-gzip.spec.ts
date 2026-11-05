/**
 * `WebServer` 的 gzip：带 `accept-encoding: gzip` 的请求必须**正常结束**且能被解压。
 *
 * 这条用例的存在理由：曾经 `pipe(res)` 发生在 `writeHead` 之前，响应头与流式写入打架，
 * 连接永不结束——浏览器（必带 gzip）因此白屏，而裸 `curl` 200 一切正常，测试完全没覆盖到。
 */
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { WebServer, WebServerDefault, WebStartup } from "@morlay/zephyr-app/testing";

@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

async function startServer(): Promise<{ app: App; webServer: WebServer; base: string }> {
  const app = await bootstrapApplication({
    providers: [Startup0, WebServerDefault],
    timeoutMs: 6_000,
  });
  const webServer = app.get(WebServer);
  return { app, webServer, base: `http://127.0.0.1:${webServer.port}` };
}

describe("WebServer 的 gzip", { timeout: 10_000 }, () => {
  const apps: App[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.dispose();
  });

  it("文本响应带 gzip：能正常结束，且解压后内容一致", async () => {
    const { app, webServer, base } = await startServer();
    apps.push(app);
    const body = `payload-${"x".repeat(2048)}`;
    webServer.register({
      kind: "exact",
      path: "/text",
      handler: (_q, s) => {
        s.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        s.end(body);
      },
    });

    const response = await fetch(`${base}/text`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    // `fetch` 会自动解压 gzip：拿到的就是原文（再 gunzip 会报 `incorrect header check`）。
    expect(await response.text()).toBe(body);
  });

  it("流式写（多次 write）同样能正常结束", async () => {
    const { app, webServer, base } = await startServer();
    apps.push(app);
    webServer.register({
      kind: "exact",
      path: "/stream",
      handler: (_q, s) => {
        s.writeHead(200, { "content-type": "application/json" });
        s.write('{"a":');
        s.write("1}");
        s.end();
      },
    });

    const response = await fetch(`${base}/stream`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
  });

  it("不可压缩类型不压（无 content-encoding）", async () => {
    const { app, webServer, base } = await startServer();
    apps.push(app);
    webServer.register({
      kind: "exact",
      path: "/bin",
      handler: (_q, s) => {
        s.writeHead(200, { "content-type": "application/octet-stream" });
        s.end("raw");
      },
    });

    const response = await fetch(`${base}/bin`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("raw");
  });
});
