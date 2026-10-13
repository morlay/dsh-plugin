/**
 * 桌面形态的 ws 端点：进程内回环（随机端口、只回环）上的升级分发。
 *
 * 页面侧的 `ws://app/…` 在自定义协议下无处可去，壳把这里的端口经 preload 交给页面，页面把地址重写成
 * `ws://127.0.0.1:<port>/…` 即可用**原生 `WebSocket`**——垫片不碰 ws 帧，也不需要 IPC 传字节。
 */
import { Buffer } from "node:buffer";
import { WebSocketServer, type WebSocket } from "ws";
import { describe, expect, test } from "vitest";
import { startLoopbackUpgradeServer, type UpgradeDispatcher } from "../ws-bridge.ts";

/** 最轻的替身：只要求"能把升级请求交给某个路由"。 */
function dispatcherFor(
  handler: (req: import("node:http").IncomingMessage, socket: unknown, head: Buffer) => void,
): UpgradeDispatcher {
  return {
    dispatchUpgrade(req, socket, head) {
      if ((req.url ?? "") !== "/api/remote.mux") return false;
      handler(req, socket, head);
      return true;
    },
  };
}

/** 用**真的** ws 客户端连接（页面侧就是这么用的）：回显服务端。 */
async function connect(port: number, path: string, wss: WebSocketServer): Promise<WebSocket> {
  wss.on("connection", (connection) => {
    connection.on("message", (data, isBinary) => {
      connection.send(data, { binary: isBinary });
    });
  });
  const { WebSocket: Client } = await import("ws");
  const client = new Client(`ws://127.0.0.1:${String(port)}${path}`);
  await new Promise<void>((resolve, reject) => {
    client.once("open", () => {
      resolve();
    });
    client.once("error", reject);
  });
  return client as unknown as WebSocket;
}

describe("startLoopbackUpgradeServer", () => {
  test("原生 ws 客户端能经它连上 upgrade 路由，并双向收发", async () => {
    const wss = new WebSocketServer({ noServer: true });
    const endpoint = await startLoopbackUpgradeServer(
      dispatcherFor((req, socket, head) => {
        wss.handleUpgrade(req, socket as never, head, (connection) => {
          wss.emit("connection", connection, req);
        });
      }),
    );

    expect(endpoint.port).toBeGreaterThan(0);
    const client = await connect(endpoint.port, "/api/remote.mux", wss);
    const echoed = new Promise<string>((resolve) => {
      client.once("message", (data) => {
        resolve(Buffer.from(data as Buffer).toString("utf8"));
      });
    });
    client.send("ping");
    await expect(echoed).resolves.toBe("ping");

    client.close();
    endpoint.dispose();
    wss.close();
  });

  test("没有对应路由的升级请求会被直接关掉", async () => {
    const endpoint = await startLoopbackUpgradeServer(dispatcherFor(() => undefined));
    const { WebSocket: Client } = await import("ws");
    const client = new Client(`ws://127.0.0.1:${String(endpoint.port)}/nope`);
    const failed = new Promise<void>((resolve) => {
      client.on("error", () => {
        resolve();
      });
      client.on("close", () => {
        resolve();
      });
    });
    await failed;
    endpoint.dispose();
  });
});
