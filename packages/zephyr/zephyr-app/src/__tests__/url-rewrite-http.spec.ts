/**
 * 出站 URL 重写的接线：真 http 请求走一遍 `attachUrlRewriting`，客户端拿到的正文已带 `/_zephyr` 前缀。
 *
 * 为什么单独一条：纯函数（`rewriteUrls`）已被 `url-prefix.spec.ts` 覆盖，这里守的是**接线**——
 * `res.write`/`res.end` 被包装后，分片（含多次 write 的流式响应）都要过改写。
 */
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { WebServer, WebServerDefault, WebStartup, attachUrlRewriting } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";

@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

describe("出站 URL 重写的接线", { timeout: 10_000 }, () => {
  const apps: App[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.dispose();
  });

  it("流式 write 的分片与 end 的分片都改写", async () => {
    const app = await bootstrapApplication({ providers: [Startup0, WebServerDefault], timeoutMs: 6_000 });
    apps.push(app);
    const webServer = app.get(WebServer);
    webServer.register({
      kind: "exact",
      path: "/mod",
      handler: (_q, s) => {
        attachUrlRewriting(s);
        s.writeHead(200, { "content-type": "application/javascript" });
        s.write('import a from "/@fs/tmp/a.ts";');
        s.write('import b from "/@id/__x00__rows";');
        s.end('export default "/@vite/client";');
      },
    });

    const response = await fetch(`http://127.0.0.1:${webServer.port}/mod`);
    const body = await response.text();
    expect(body).toBe(
      'import a from "/_zephyr/@fs/tmp/a.ts";import b from "/_zephyr/@id/__x00__rows";export default "/_zephyr/@vite/client";',
    );
  });
});
