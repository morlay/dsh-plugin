// 只服务 `/api/remote.mux` 的 http server：**直接用上游的协议实现**，分派点按本夹具的需要给。
//
// 用真 `http` + 真 `WebSocket`（node 侧）：这条缝的两端都是协议，不是平台，
// 所以不需要浏览器就能验「客户端 transport ↔ 服务端帧分发」。
//
// 这里不装框架那一行（`MuxServer`）：夹具要的是「宿主推什么、客户端就收到什么」，把准入、DI、
// upload 分派都拉进来只会让判据停在别处。协议的复用面是上游的 `RemoteStreamMuxServer`。
import { createServer, type Server } from "node:http";
import { RemoteStreamMuxServer } from "@deepseek-ai/dsh-api-gateway/src/stream-server.ts";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";

/** 起一个 mux server，返回它的 url、路由表、事件源入口与关闭句柄。 */
export async function serveMux(): Promise<{
  url: string;
  handlers: RemoteHandlersDefault;
  server: Server;
  /** 往「转发事件源」推一帧（上游 `$events` 流的 `emit` / `waterfall` 帧）。 */
  push: (frame: unknown) => void;
}> {
  const handlers = new RemoteHandlersDefault();
  /** 每条流一个队列（测试侧 `push` 往 `$events` 塞帧）。 */
  const queues = new Map<string, unknown[]>();
  const wakes = new Map<string, () => void>();
  const queueOf = (endpoint: string): unknown[] => {
    const existing = queues.get(endpoint);
    if (existing !== undefined) return existing;
    const created: unknown[] = [];
    queues.set(endpoint, created);
    return created;
  };
  /** 客户端上行（`terminal/attach` 那类双向流才用）。 */
  const uplinks = new Map<string, unknown[]>();
  const peer = {
    id: "fixture",
    signal: new AbortController().signal,
    interactions: "answer",
    principal: { kind: "owner" },
    // 上游 mux 用 `peer.ctx.effect` 把 socket 绑到 peer 的作用域上：缺了它 socket 会被立刻关掉。
    ctx: { effect: () => () => {} },
  };
  const mux = new RemoteStreamMuxServer(
    async (endpoint, payload, uplink) => {
      const args = (payload as { args?: Record<string, unknown> } | undefined)?.args ?? {};
      const own = handlers.stream(endpoint, args, new AbortController().signal, uplink);
      if (own !== undefined) return own;
      if (endpoint === "$events") {
        const list = queueOf(endpoint);
        return {
          async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
            yield { type: "ready", clientId: "fixture", host: { home: "/tmp" } };
            for (;;) {
              const next = list.shift();
              if (next !== undefined) {
                yield next;
                continue;
              }
              await new Promise<void>((resolve) => {
                wakes.set(endpoint, resolve);
              });
            }
          },
        };
      }
      const items = uplinks.get(endpoint) ?? [];
      uplinks.set(endpoint, items);
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
          for (;;) {
            const next = items.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              wakes.set(endpoint, resolve);
            });
          }
        },
      };
    },
    () => ({ code: "gateway/invoke-failed", message: "x", details: {} }),
    {
      heartbeatIntervalMs: 2_000,
      streamInboxBytes: 262_144,
      streamOutboxBytes: 1_048_576,
      compression: false,
    },
  );

  // 两级 wire：unary 走 `/api/<endpoint>` 的 HTTP RPC（上游的 client-request 信封），
  // 流式与事件流走 `/api/remote.mux` 的 upgrade。夹具把两面都挂在同一个 server 上。
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "/";
    if (req.method !== "POST" || !path.startsWith("/api/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const endpoint = path.slice("/api/".length);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      void (async () => {
        const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          readonly rpcId?: string;
          readonly payload?: { readonly args?: Record<string, unknown> };
        };
        const result = await handlers.invoke(endpoint, envelope.payload?.args ?? {}).then(
          (value) => ({ ok: true, value }),
          (error: unknown) => ({
            ok: false,
            error: { code: "gateway/invoke-failed", message: String(error), details: {} },
          }),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "server-response", rpcId: envelope.rpcId, result }));
      })();
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0] ?? "/";
    if (path !== "/api/remote.mux") {
      socket.destroy();
      return;
    }
    mux.handleUpgrade(req, socket, head, peer);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("没有监听端口");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    handlers,
    server,
    push: (frame: unknown) => {
      queueOf("$events").push(frame);
      const resume = wakes.get("$events");
      wakes.delete("$events");
      resume?.();
    },
  };
}

/** 关掉 server（不给 socket 留悬挂连接，测试才不会卡 10s）。 */
export async function closeMux(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await Promise.race([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise((resolve) => setTimeout(resolve, 300)),
  ]);
}
