// 框架 wire 面的**真服务**夹具：一份与 dev 同形的宿主（WebServer + Connection + Typert + ApiGateway +
// mux），外加浏览器那一侧的 `muxTransport`。框架各能力的全流程用例都从这里起，不再各拼一份替身。
//
// 为什么必须真起：unary 失败信封、共享 `/api` 通道、`$events` 的分流与重建，这些都只在真实
// HTTP/WS 上成立——替身能把任何一环说成通过。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { muxTransport, type RemoteFetch, type RemoteTransport } from "@morlay/zephyr-app/client";
import {
  CredentialsInMemory,
  FakeAppEnv,
  WebServer,
  provideApiGateway,
  provideConnection,
  provideMuxServer,
  provideTypert,
  provideWeb,
} from "@morlay/zephyr-app/testing";

/** 一份起好的 wire 宿主与它的浏览器端。 */
export interface WireApp {
  readonly app: App;
  /** 页面的基址（`http://127.0.0.1:<port>`）。 */
  readonly origin: string;
  /** 浏览器那一侧：真 WebSocket（流式与 `$events`）+ 真 HTTP（unary 与 `$events/result`）。 */
  client(): RemoteTransport;
  /** 幂等：重复调用只拆一次。 */
  dispose(): Promise<void>;
}

/**
 * 起一份 wire 宿主。
 * @returns 宿主、页面基址、客户端工厂与幂等 dispose。
 */
export async function mountWireApp(): Promise<WireApp> {
  const root = await mkdtemp(join(tmpdir(), "zephyr-app-wire-"));
  FakeAppEnv.root = root;
  // `WebStartupDefault` 读 `process.env.PORT`（缺省 3080）：并行 spec 会抢同一个端口。
  process.env.PORT = "0";
  let app: App | undefined;
  let disposed: Promise<void> | undefined;
  try {
    app = await bootstrapApplication({
      providers: [
        FakeAppEnv,
        CredentialsInMemory,
        ...provideWeb(),
        ...provideConnection(),
        ...provideTypert(),
        ...provideApiGateway(),
        ...provideMuxServer(),
      ],
      timeoutMs: 20_000,
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const origin = `http://127.0.0.1:${String(app.get(WebServer).port)}`;
  return {
    app,
    origin,
    client: () => clientOf(origin),
    dispose: () =>
      (disposed ??= (async () => {
        await app?.dispose().catch(() => {});
        await rm(root, { recursive: true, force: true });
      })()),
  };
}

/**
 * 浏览器那一侧的 transport：真 WebSocket + 真 HTTP，地址接到给定 origin 上
 * （非浏览器宿主没有 `location`，传输层回落的是本机地址，不带本用例的端口）。
 * @param origin - 页面基址。
 * @returns 客户端 transport。
 */
export function clientOf(origin: string): RemoteTransport {
  const fetchOf: RemoteFetch = (input, init) =>
    fetch(`${origin}${new URL(String(input), origin).pathname}`, init);
  return muxTransport(
    () =>
      ({
        openWebSocket: (path: string) => new WebSocket(`${origin.replace(/^http/u, "ws")}${path}`),
      }) as never,
    fetchOf,
  );
}
