/**
 * 出站 URL 重写的**接线**：把 `attachUrlRewriting` 接到一个真 `WebServer` 路由上，
 * 流式 `write` 与 `end` 的分片都要被改写。
 *
 * 为什么在 dev 这一侧：改写函数（`addZephyrPrefix` / `rewriteUrls`）是 vite URL 空间的事，
 * 归构建链；`WebServer` 只是它们的挂载点，两条合起来才验证得到"接线是不是接对了"。
 */
import { Injectable } from "@morlay/zephyr";
import {
  bootTwoSided,
  describe,
  expect,
  test,
  WebServer,
  WebServerDefault,
  WebStartup,
} from "@morlay/zephyr-app/testing";
import { attachUrlRewriting } from "../internal/hmr-path.ts";

/** 固定回环端口 0（随机）：并行跑的 spec 不互相抢。 */
@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

/**
 * 起一份带 `/mod` 路由的 host（路由把 `attachUrlRewriting` 接到响应流上）。
 *
 * `bootTwoSided` 负责收尾：host 装配随用例关，spec 里既没有 `beforeAll` 也没有 `afterAll`。
 * @returns 访问地址。
 */
async function baseOf(): Promise<string> {
  const { host } = await bootTwoSided({ createHost: () => [Startup0, WebServerDefault] });
  const webServer = host.get(WebServer);
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
  return `http://127.0.0.1:${String(webServer.port)}`;
}

describe("出站 URL 重写的接线", { timeout: 10_000 }, () => {
  test("流式 write 的分片与 end 的分片都改写", async () => {
    const response = await fetch(`${await baseOf()}/mod`);
    expect(await response.text()).toBe(
      'import a from "/_zephyr/@fs/tmp/a.ts";import b from "/_zephyr/@id/__x00__rows";export default "/_zephyr/@vite/client";',
    );
  });
});
