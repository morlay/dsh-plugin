/**
 * 路由可观测性：注册即记录（`routesOf()`），命中走真 http 请求。
 *
 * 只验 `WebServer` 这一职责（路由表 + fallback + upgrade），不牵扯 client 链；
 * 打印由 `WebRuntimeService` 读同一份 `routesOf()` 输出，另有单测覆盖。
 */
import { connect } from "node:net";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { FEDERATION_PREFIX, HMR_PATH } from "@morlay/zephyr-app";
import { WebServer, WebServerDefault, WebStartup } from "@morlay/zephyr-app";

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

describe("路由可观测性", { timeout: 10_000 }, () => {
  const apps: App[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.dispose();
  });

  it("注册即记录：prefix / fallback / upgrade 都出现在 routesOf()", async () => {
    const { app, webServer } = await startServer();
    apps.push(app);

    webServer.register({ kind: "prefix", path: FEDERATION_PREFIX, handler: (_q, s) => {
      s.end("ok");
    } });
    webServer.registerFallback((_q, s) => {
      s.end("fallback");
    });
    webServer.registerUpgrade({ path: HMR_PATH, handler: () => {} });

    expect(webServer.routesOf()).toEqual([
      { kind: "prefix", path: FEDERATION_PREFIX },
      { kind: "fallback", path: "*" },
      { kind: "upgrade", path: HMR_PATH },
    ]);
  });

  it("prefix 命中、未注册路径走 fallback、未注册 upgrade 被断开", async () => {
    const { app, webServer, base } = await startServer();
    apps.push(app);

    webServer.register({ kind: "prefix", path: FEDERATION_PREFIX, handler: (_q, s) => {
      s.end("federation");
    } });
    webServer.registerFallback((_q, s) => {
      s.end("fallback");
    });

    const hit = await fetch(`${base}${FEDERATION_PREFIX}/pkg@1/index.js`);
    expect(await hit.text()).toBe("federation");

    const miss = await fetch(`${base}/nowhere`);
    expect(await miss.text()).toBe("fallback");

    // 未注册的升级：socket 被断开（`connect` 后立刻收到 close）。
    const closed = await new Promise<boolean>((resolve) => {
      const socket = connect(webServer.port, "127.0.0.1", () => {
        socket.write(
          `GET ${HMR_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        );
      });
      socket.on("close", () => resolve(true));
      socket.on("error", () => resolve(true));
    });
    expect(closed).toBe(true);
  });
});
