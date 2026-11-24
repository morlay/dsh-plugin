/**
 * `WebServer` 的两件事（一套装配跑完）：路由表与 fallback / upgrade、gzip。
 *
 * 这三件原本是三个文件、各起一次服务——它们共享同一份 `WebServer` 装配，分开只是重复支付启动成本，
 * 并不会让失败定位更清楚（每条断言仍然只读自己那条路由）。
 *
 * `ws-probe` 那条守的是**默认 provider 入口**（`WebStartupDefault`），单独一个 app：它验的是
 * 「不写 Startup 也能起来」，不能被自定义 Startup 顶替。
 */
import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import {
  bootTwoSided,
  describe,
  expect,
  test as base,
  WebServer,
  WebServerDefault,
  WebStartup,
  WebStartupDefault,
} from "@morlay/zephyr-app/testing";

/** 一条前缀路由与一条 upgrade 路由（`WebServer` 的机制，与具体业务前缀无关）。 */
const PREFIX = "/_test/@modules";
const UPGRADE = "/_test/hmr";

// 随机端口：`WebStartupDefault` 读 `process.env.PORT`（缺省 3080），并行跑的 web spec 会互相抢。
process.env.PORT ??= "0";

@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

/** gzip 用例的正文（大于阈值，才会被压）。 */
const BODY = `payload-${"x".repeat(2048)}`;

/** 本文件的一份 `WebServer` 装配：路由表随装配建一次，用例结束随之关闭。 */
interface WebFixtures {
  readonly web: { readonly webServer: WebServer; readonly base: string };
}

const test = base.extend<WebFixtures>({
  async web({}, use) {
    // 双端工厂负责收尾：host 侧装配 + `onTestFinished(dispose)`，spec 里没有 beforeAll/afterAll。
    const { host } = await bootTwoSided({ createHost: () => [Startup0, WebServerDefault] });
    const webServer = host.get(WebServer);

    // 路由只在装配后注册一次：各用例读同一份路由表（「注册即记录」见第一条用例）。
    webServer.register({
      kind: "prefix",
      path: PREFIX,
      handler: (_q, s) => {
        s.end("federation");
      },
    });
    webServer.registerFallback((_q, s) => {
      s.end("fallback");
    });
    webServer.registerUpgrade({ path: UPGRADE, handler: () => {} });
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
    await use({ webServer, base: `http://127.0.0.1:${String(webServer.port)}` });
  },
});

describe("auth: required 的路由（上游 0.2.3 的 owner Peer 档）", { timeout: 10_000 }, () => {
  test("没有连接面时拒绝（403），不会把 handler 当公开路由跑", async () => {
    // 这条装配只有 WebServer：`Connection` 缺席 → 准入无从判定，必须拒绝而不是放行。
    const strict = await bootstrapApplication({
      providers: [Startup0, WebServerDefault],
      timeoutMs: 6_000,
    });
    try {
      const server = strict.get(WebServer);
      let called = 0;
      server.register({
        kind: "exact",
        path: "/_test/owner-only",
        auth: "required",
        handler: (_q, s) => {
          called += 1;
          s.end("ok");
        },
      });
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/_test/owner-only`);
      expect(response.status).toBe(403);
      expect(called).toBe(0);
    } finally {
      await strict.dispose();
    }
  });
});

describe("路由表与 fallback / upgrade", { timeout: 10_000 }, () => {
  test("注册即记录：prefix / fallback / upgrade 都出现在 routesOf()", ({ web }) => {
    const { webServer } = web;
    expect(webServer.routesOf()).toEqual(
      expect.arrayContaining([
        { kind: "prefix", path: PREFIX },
        { kind: "fallback", path: "*" },
        { kind: "upgrade", path: UPGRADE },
      ]),
    );
  });

  test("prefix 命中", async ({ web }) => {
    const { base } = web;
    const response = await fetch(`${base}${PREFIX}/pkg@1/index.js`);
    expect(await response.text()).toBe("federation");
  });

  test("未注册路径走 fallback", async ({ web }) => {
    const { base } = web;
    const response = await fetch(`${base}/nowhere`);
    expect(await response.text()).toBe("fallback");
  });

  test("未注册的 upgrade 被断开", async ({ web }) => {
    const { webServer } = web;
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
  test("文本响应带 gzip：能正常结束，且解压后内容一致", async ({ web }) => {
    const { base } = web;
    const response = await fetch(`${base}/text`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    // `fetch` 会自动解压 gzip：拿到的就是原文（再 gunzip 会报 `incorrect header check`）。
    expect(await response.text()).toBe(BODY);
  });

  test("流式写（多次 write）同样能正常结束", async ({ web }) => {
    const { base } = web;
    const response = await fetch(`${base}/stream`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
  });

  test("不可压缩类型不压（无 content-encoding）", async ({ web }) => {
    const { base } = web;
    const response = await fetch(`${base}/bin`, { headers: { "accept-encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("raw");
  });
});

describe("webserver listen（单 Provider 入口）", { timeout: 10_000 }, () => {
  test("onInit 跑完端口可用", async () => {
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

describe("端口协商", () => {
  test("期望端口被占用时顺延到下一个能用的端口，并报出实际地址", async () => {
    // 先占住一个随机端口（不指定具体值：并行跑的用例也在抢端口）。
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const taken = (blocker.address() as AddressInfo).port;
    /** 期望端口 = 刚被占住的那个。 */
    @Injectable()
    class StartupTaken extends WebStartup {
      readonly values = { host: "127.0.0.1", port: taken, trustedHosts: [] };
    }
    const portApp = await bootstrapApplication({
      providers: [StartupTaken, WebServerDefault],
      timeoutMs: 6_000,
    });
    try {
      const portWeb = portApp.get(WebServer);
      // 被占不是启动失败：换一个端口起来，并把实际值交给调用方（它据此拼访问地址）。
      expect(portWeb.port).not.toBe(taken);
      expect(portWeb.port).toBeGreaterThan(taken);
    } finally {
      await portApp.dispose();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
