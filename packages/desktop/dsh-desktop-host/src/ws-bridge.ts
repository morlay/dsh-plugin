/**
 * 桌面形态的 ws 端点。
 *
 * 页面在自定义协议下（`dsh-…://app/`）拿不到 ws 端点：前端按 origin 拼出来的 `ws://app/api/remote.mux`
 * 既没有可用的 host，浏览器也只认 `ws:`/`wss:`。这里在**宿主进程内**起一个 loopback 监听（随机端口、
 * 只回环、不出本机），把升级请求交给真正的 upgrade 路由（`/api/remote.mux` 那类由 `ws` 库托管的服务端）；
 * 壳把这个端口经 preload 告诉页面，页面把地址重写过来就能用**原生 `WebSocket`**——不自己碰 ws 帧。
 */
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";

/** 只需要这一件事（结构化类型：不绑定具体实现，测试里可以用最轻的替身）。 */
export interface UpgradeDispatcher {
  dispatchUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

export interface LoopbackUpgradeServer {
  /** `127.0.0.1:<port>` 上的端口（页面据此重写 `ws://app/…`）。 */
  readonly port: number;
  /**
   * 这个 http server 本身。**vite 的 HMR 要挂在它上面**（`server.hmr.server`）：桌面形态没有别的同源
   * http server，HMR 的 WebSocket 只能落在同一个回环端点上（页面侧被垫片重写到它）。
   */
  readonly server: HttpServer;
  dispose(): void;
}

export async function startLoopbackUpgradeServer(
  dispatcher: UpgradeDispatcher,
): Promise<LoopbackUpgradeServer> {
  const server: HttpServer = createServer((_req, res) => {
    // 这个监听只服务 ws 升级；普通请求没有意义。
    res.writeHead(426).end();
  });
  server.on("upgrade", (req, socket, head) => {
    if (dispatcher.dispatchUpgrade(req, socket, head)) return;
    // 不是 webServer 的路由：同一个 server 上还挂着 vite 的 HMR，交给它；两边都不认才关掉。
    if (server.listenerCount("upgrade") <= 1) socket.destroy();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    server,
    dispose() {
      server.close();
    },
  };
}
