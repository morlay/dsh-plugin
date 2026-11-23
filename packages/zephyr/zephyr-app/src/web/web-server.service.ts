// HTTP 宿主：node:http 自实现（路由表 + fallback + upgrade + listen + gzip）。
//
// 不用上游 `dsh-host-webserver`（bundle 级、依赖混乱），也不用 hono（它的 Response 语义与
// 「handler 直接写 res」冲突——federation 与 vite 转发都要接管原始响应）。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createGzip, type Gzip } from "node:zlib";
import { inject, Injectable, Logger, type OnDispose, type OnInit } from "@morlay/zephyr";
import { Connection } from "../connection/contract.ts";
import { trustRequestOf } from "../connection/connection.service.ts";
import type { WebRoute, WebUpgradeRoute } from "./route.types.ts";
import { WebServer, type RegisteredRoute } from "./web-server.contract.ts";
import { WebStartup } from "./web-startup.contract.ts";

type FallbackHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface HandlerEntry {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  /** 上游 0.2.3 的准入档：`required` 的路由在派发前走 `Connection.admit`。 */
  readonly auth: "required" | "none";
  readonly handler: WebRoute["handler"];
}

/** 值得压缩的类型（文本类）；二进制/已压缩格式不碰。 */
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|wasm)|image\/svg)/u;

@Injectable()
export class WebServerDefault extends WebServer implements OnInit, OnDispose {
  private readonly startup = inject(WebStartup);

  private readonly logger = inject(Logger);

  /** 宿主连接面：`auth: "required"` 的路由要靠它做准入。`optional` 是为了断开与 `connection` 行的环。 */
  private readonly connection = inject.optional(Connection);

  private readonly entries: HandlerEntry[] = [];

  private readonly upgrades: WebUpgradeRoute[] = [];

  private readonly registered: RegisteredRoute[] = [];

  private fallback: FallbackHandler | undefined;

  private http: Server | undefined;

  host = "127.0.0.1";

  // 0 = 还没 listen 完（真实端口由 listen 回调回写；`port: 0` 的装配也能等到）。
  port = 0;

  readonly protocol = "http:";

  get server(): Server | undefined {
    return this.http;
  }

  routesOf(): readonly RegisteredRoute[] {
    return this.registered;
  }

  register(route: WebRoute): () => void {
    this.entries.push({
      kind: route.kind,
      path: route.path,
      auth: route.auth ?? "none",
      // 包一层而不是直接引用方法：`this` 留在 route 上（消费方按 `entry.handler(req, res)` 调）。
      handler: (req, res, peer) => route.handler(req, res, peer),
    });
    this.registered.push({ kind: route.kind, path: route.path });
    return () => {
      const index = this.entries.findIndex((entry) => entry.path === route.path);
      if (index >= 0) this.entries.splice(index, 1);
    };
  }

  registerUpgrade(route: WebUpgradeRoute): () => void {
    this.upgrades.push(route);
    this.registered.push({ kind: "upgrade", path: route.path });
    return () => {
      const index = this.upgrades.indexOf(route);
      if (index >= 0) this.upgrades.splice(index, 1);
    };
  }

  registerFallback(handler: FallbackHandler): () => void {
    this.fallback = handler;
    this.registered.push({ kind: "fallback", path: "*" });
    return () => {
      if (this.fallback === handler) this.fallback = undefined;
    };
  }

  // 等 listen 完成再返回：装配完成的那一刻端口就必须可用（否则调用方拿到 `port: 0`）。
  async onInit(): Promise<void> {
    this.host = this.startup.values.host ?? "127.0.0.1";
    const requestedPort = this.startup.values.port ?? 3080;
    const server = createServer((req, res) => {
      // 访问日志的唯一 home：每个请求一行（方法 / 路径 / 状态 / 耗时）。dev 形态下它就是排查入口，
      // 所以直接写 stdout（不受 logger 级别过滤）。
      const startedAt = Date.now();
      const path = pathOf(req);
      res.on("finish", () => {
        process.stdout.write(
          `[web] ${req.method ?? "GET"} ${path} → ${res.statusCode} ${Date.now() - startedAt}ms\n`,
        );
      });
      void this.dispatch(gzipIfAcceptable(req, res), req).catch(() => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    });
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = pathOf(req);
      const route = this.upgrades.find((entry) => entry.path === path);
      if (route === undefined) {
        // 未注册的升级直接断开：避免 socket 悬挂。
        this.logger.warn("[upgrade] 未注册的路径 %s：socket 直接断开", path);
        socket.destroy();
        return;
      }
      try {
        void route.handler(req, socket, head);
      } catch (error) {
        // 升级处理抛错时 node 不会替我们记：没有这条，浏览器只看到「连不上」。
        this.logger.error("[upgrade] %s 的处理失败：%s", path, String(error));
        socket.destroy();
      }
    });
    this.http = server;
    // **端口冲突不是错误**：期望端口被占时顺延（见 `listenWithFallback`），并把实际地址打出来。
    // 否则 `zephyr preview` 第二次启动就直接 EADDRINUSE 退出，用户只看到一句 node 的错误码。
    this.port = await listenWithFallback(server, requestedPort, this.host, (requested, actual) => {
      this.logger.warn("端口 %d 被占用，改用 %d", requested, actual);
    });
    // 启动后把**可点的地址**打出来：端口顺延或取 0（随机）时，调用方只能从这行知道该访问哪。
    // 它是一次性事实（listen 完成那一刻），所以用 info 而不是 debug。
    this.logger.info("监听 http://%s:%d", this.host, this.port);
  }

  onDispose(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.http;
      this.http = undefined;
      if (server === undefined) {
        resolve();
        return;
      }
      // **先断在途连接**：`close()` 只停止接受新连接，它会等现有连接自己结束——浏览器开着页面
      // （HMR 的 ws、keep-alive）时永远等不到，`zephyr dev` 于是按了 Ctrl+C 也退不出去。
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }

  private async dispatch(res: ServerResponse, req: IncomingMessage): Promise<void> {
    const path = pathOf(req);
    const entry = this.entries.find((candidate) =>
      candidate.kind === "exact" ? candidate.path === path : path.startsWith(candidate.path),
    );
    if (entry !== undefined) {
      // 上游 0.2.3：`auth: "required"` 的路由要 owner Peer。准入走`Connection.admit`（与 upgrade 同一判定），
      // 被拒就回 rejection；通过就把这次请求代表的 peer 交给 handler（上游据此判 `peer.principal.kind`）。
      if (entry.auth === "required") {
        const connection = this.connection;
        if (connection === undefined) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        const admission = connection.admit(trustRequestOf(req));
        if ("rejection" in admission) {
          res.statusCode = admission.rejection;
          res.end("Forbidden");
          return;
        }
        await entry.handler(req, res, admission.peer);
        return;
      }
      await entry.handler(req, res);
      return;
    }
    if (this.fallback !== undefined) {
      await this.fallback(req, res);
      return;
    }
    res.statusCode = 404;
    res.end("Not Found");
  }
}

function pathOf(req: IncomingMessage): string {
  return (req.url ?? "/").split("?")[0] ?? "/";
}

/**
 * `accept-encoding` 里有 gzip 时，把 `res` 包成一个 gzip 流：handler 照旧 `writeHead`/`write`/`end`，
 * 可压缩类型才真的压（`content-type` 在 `writeHead` 时判断）。
 *
 * 顺序很关键：**先发头再接管**。`pipe(res)` 会立刻开始往 `res` 写，若发生在 `writeHead` 之前，
 * 响应头与流式写入打架，连接永远不结束（浏览器带 `accept-encoding: gzip` 时表现为白屏）。
 */
function gzipIfAcceptable(req: IncomingMessage, res: ServerResponse): ServerResponse {
  const accepts = (req.headers["accept-encoding"] ?? "").includes("gzip");
  if (!accepts) return res;
  let gzip: Gzip | undefined;
  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
  const write = res.write.bind(res) as (chunk: never, ...rest: never[]) => boolean;
  const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;

  res.writeHead = ((...args: unknown[]) => {
    const headers = args.find((arg) => typeof arg === "object" && arg !== null) as
      | Record<string, string | number | readonly string[]>
      | undefined;
    const contentType = String(headers?.["content-type"] ?? headers?.["Content-Type"] ?? "");
    if (COMPRESSIBLE.test(contentType)) {
      res.setHeader("content-encoding", "gzip");
      res.removeHeader("content-length");
    }
    // 先把响应头发出去（已带 `content-encoding`），再接管数据通道。
    const out = writeHead(...args);
    if (COMPRESSIBLE.test(contentType)) {
      const stream = createGzip();
      gzip = stream;
      // handler 可能在 `end()` 之后再写：吞掉 write-after-end，不让它升级成进程级错误。
      stream.on("error", () => {
        stream.destroy();
      });
      stream.on("data", (chunk: Buffer) => {
        write(chunk as never);
      });
      stream.on("end", () => {
        end();
      });
    }
    return out;
  }) as ServerResponse["writeHead"];

  res.write = ((chunk: never, ...rest: never[]) => {
    if (gzip !== undefined) {
      if (gzip.writableEnded || gzip.destroyed) return false;
      return gzip.write(chunk);
    }
    return write(chunk, ...rest);
  }) as ServerResponse["write"];

  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (gzip !== undefined) {
      if (gzip.writableEnded || gzip.destroyed) return res;
      if (chunk !== undefined) gzip.write(chunk as never);
      gzip.end();
      return res;
    }
    // eslint-disable-next-line no-undefined -- node 的 `end(chunk?, cb?)` 允许缺省
    return end(...([chunk, ...rest] as unknown[]));
  }) as ServerResponse["end"];

  return res;
}

/**
 * 在期望端口上起监听；被占用就顺延（+1…+100）。
 *
 * 为什么顺延而不是报错：同一个应用常常要同时起两份（对照两个分支、两个工作区），固定端口让第二份
 * 直接起不来；「换一个端口 + 把地址打出来」是用户能直接用的结果。上限之内仍失败才抛：那时更可能是
 * 配置写错了。
 * @param server - http server（还没 listen）。
 * @param requested - 期望端口。
 * @param host - 监听地址。
 * @param onFallback - 每顺延一次调一次（期望端口与实际尝试的端口）。
 * @returns 实际监听的端口。
 * @throws 非 `EADDRINUSE` 的错误，或顺延到上限仍失败。
 */
async function listenWithFallback(
  server: Server,
  requested: number,
  host: string,
  onFallback: (requested: number, actual: number) => void,
): Promise<number> {
  const MAX_OFFSET = 100;
  for (let offset = 0; offset <= MAX_OFFSET; offset += 1) {
    const port = requested + offset;
    try {
      return await new Promise<number>((resolve, reject) => {
        const cleanup = (): void => {
          server.off("error", onError);
          server.off("listening", onListening);
        };
        const onError = (error: unknown): void => {
          cleanup();
          reject(error);
        };
        const onListening = (): void => {
          cleanup();
          const address = server.address();
          resolve(typeof address === "object" && address !== null ? address.port : port);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || offset === MAX_OFFSET) throw error;
      onFallback(requested, port + 1);
    }
  }
  // 循环要么返回要么抛；这一行只为类型完整。
  throw new Error(`端口 ${String(requested)}–${String(requested + MAX_OFFSET)} 全部被占用`);
}
