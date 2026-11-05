/**
 * `WebServer` 的三件事（一套装配跑完）：路由表与 fallback / upgrade、gzip、出站 URL 重写接线。
 *
 * 这三件原本是三个文件、各起一次服务——它们共享同一份 `WebServer` 装配，分开只是重复支付启动成本，
 * 并不会让失败定位更清楚（每条断言仍然只读自己那条路由）。
 *
 * `ws-probe` 那条守的是**默认 provider 入口**（`WebStartupDefault`），单独一个 app：它验的是
 * 「不写 Startup 也能起来」，不能被自定义 Startup 顶替。
 */
import { connect } from "node:net";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FEDERATION_PREFIX,
  HMR_PATH,
  WebServer,
  WebServerDefault,
  WebStartup,
  WebStartupDefault,
  attachUrlRewriting,
} from "@morlay/zephyr-app/testing";

// 随机端口：`WebStartupDefault` 读 `process.env.PORT`（缺省 3080），并行跑的 web spec 会互相抢。
process.env.PORT ??= "0";

@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

/** gzip 用例的正文（大于阈值，才会被压）。 */
const BODY = `payload-${"x".repeat(2048)}`;

let app: App;
let webServer: WebServer;
let base: string;

beforeAll(async () => {
  app = await bootstrapApplication({ providers: [Startup0, WebServerDefault], timeoutMs: 6_000 });
  webServer = app.get(WebServer);
  base = `http://127.0.0.1:${String(webServer.port)}`;

  // 路由只在装配后注册一次：各用例读同一份路由表（「注册即记录」见第一条用例）。
  webServer.register({
    kind: "prefix",
    path: FEDERATION_PREFIX,
    handler: (_q, s) => {
      s.end("federation");
    },
  });
  webServer.registerFallback((_q, s) => {
    s.end("fallback");
  });
  webServer.registerUpgrade({ path: HMR_PATH, handler: () => {} });
  webServer.register({
    kind: "exact",
    path: "/text",
    handler: (_q, s) => {
      s.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      s.end(BODY);
    },
  });
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
  webServer.register({
    kind: "exact",
    path: "/bin",
    handler: (_q, s) => {
      s.writeHead(200, { "content-type": "application/octet-stream" });
      s.end("raw");
    },
  });
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
});

afterAll(async () => {
  await app.dispose();
});

describe("路由表与 fallback / upgrade", { timeout: 10_000 }, () => {
  it("注册即记录：prefix / fallback / upgrade 都出现在 routesOf()", () => {
    expect(webServer.routesOf()).toEqual(
      expect.arrayContaining([
        { kind: "prefix", path: FEDERATION_PREFIX },
        { kind: "fallback", path: "*" },
        { kind: "upgrade", path: HMR_PATH },
      ]),
    );
  });

  it("prefix 命中", async () => {
    const response = await fetch(`${base}${FEDERATION_PREFIX}/pkg@1/index.js`);
    expect(await response.text()).toBe("federation");
  });

  it("未注册路径走 fallback", async () => {
    const response = await fetch(`${base}/nowhere`);
    expect(await response.text()).toBe("fallback");
  });

  it("未注册的 upgrade 被断开", async () => {
    // 未注册的升级：socket 被断开（`connect` 后立刻收到 close）。
    const closed = await new Promise<boolean>((resolve) => {
      const socket = connect(webServer.port, "127.0.0.1", () => {
        socket.write(
          `GET /not-registered HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        );
      });
      socket.on("close", () => resolve(true));
      socket.on("error", () => resolve(true));
    });
    expect(closed).toBe(true);
  });
});

describe("gzip", { timeout: 10_000 }, () => {
  it("文本响应带 gzip：能正常结束，且解压后内容一致", async () => {
    const response = await fetch(`${base}/text`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    // `fetch` 会自动解压 gzip：拿到的就是原文（再 gunzip 会报 `incorrect header check`）。
    expect(await response.text()).toBe(BODY);
  });

  it("流式写（多次 write）同样能正常结束", async () => {
    const response = await fetch(`${base}/stream`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
  });

  it("不可压缩类型不压（无 content-encoding）", async () => {
    const response = await fetch(`${base}/bin`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("raw");
  });
});

describe("出站 URL 重写的接线", { timeout: 10_000 }, () => {
  it("流式 write 的分片与 end 的分片都改写", async () => {
    const response = await fetch(`${base}/mod`);
    expect(await response.text()).toBe(
      'import a from "/_zephyr/@fs/tmp/a.ts";import b from "/_zephyr/@id/__x00__rows";export default "/_zephyr/@vite/client";',
    );
  });
});

describe("webserver listen（单 Provider 入口）", { timeout: 10_000 }, () => {
  it("onInit 跑完端口可用", async () => {
    const defaultApp = await bootstrapApplication({
      providers: [WebStartupDefault, WebServerDefault],
      timeoutMs: 10_000,
    });
    try {
      expect(defaultApp.get(WebServer).port).toBeGreaterThan(0);
    } finally {
      await defaultApp.dispose();
    }
  });
});
