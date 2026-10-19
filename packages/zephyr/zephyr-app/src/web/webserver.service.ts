// HTTP 宿主：node:http 自实现（路由表 + fallback + upgrade + listen + gzip）。
//
// 不用上游 `dsh-host-webserver`（bundle 级、依赖混乱），也不用 hono（它的 Response 语义与
// 「handler 直接写 res」冲突——federation 与 vite 转发都要接管原始响应）。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createGzip, type Gzip } from "node:zlib";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import type { WebRoute, WebUpgradeRoute } from "./route.types.ts";
import { WebServer, type RegisteredRoute } from "./web-server.contract.ts";
import { WebStartup } from "./web-startup.contract.ts";

type FallbackHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface HandlerEntry {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  readonly handler: WebRoute["handler"];
}

/** 值得压缩的类型（文本类）；二进制/已压缩格式不碰。 */
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|wasm)|image\/svg)/u;

@Injectable()
export class WebServerDefault extends WebServer implements OnInit, OnDispose {
  private readonly startup = inject(WebStartup);

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
    this.entries.push({ kind: route.kind, path: route.path, handler: route.handler });
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
        socket.destroy();
        return;
      }
      void route.handler(req, socket, head);
    });
    this.http = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(requestedPort, this.host, () => {
        const address = server.address();
        if (typeof address === "object" && address !== null) this.port = address.port;
        resolve();
      });
    });
  }

  onDispose(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.http;
      this.http = undefined;
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  private async dispatch(res: ServerResponse, req: IncomingMessage): Promise<void> {
    const path = pathOf(req);
    const entry = this.entries.find(
      (candidate) => candidate.kind === "exact" ? candidate.path === path : path.startsWith(candidate.path),
    );
    if (entry !== undefined) {
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
