/**
 * 桌面形态的 `webServer` 服务：与上游同名的路由载体，但不监听任何端口。
 *
 * 上游 `@deepseek-ai/dsh-host-webserver` 在激活时 `listen`。桌面宿主自己拥有页面，
 * 没有网络入口，于是这里保留同一份服务面（register / registerFallback / registerUpgrade /
 * tapIndex / renderIndex / collectIndexInjections / port / host），把请求由 `dispatch`
 * 从字节管道直接喂进来。
 */

import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { Service, type Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import {
  renderIndexInjections,
  type IndexInjection,
} from "@deepseek-ai/dsh-host-webserver";

export interface WebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export interface WebUpgradeRoute {
  readonly path: string;
  readonly handler: (req: IncomingMessage, socket: unknown, head: Buffer) => void | Promise<void>;
}

export interface PortlessWebServerConfig {
  readonly host?: "127.0.0.1" | "0.0.0.0";
  readonly port?: number;
}

interface StartedResponse {
  readonly status: number;
  readonly headers: Headers;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** 由 handler 写出的 node 风格响应：写出头部即对外可见，`end` 收尾响应体流。 */
class SyntheticResponse extends EventEmitter {
  statusCode = 200;
  statusMessage = "";
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  /** 上游中间件按 `res.socket === undefined` 识别「没有真实连接」。 */
  readonly socket = undefined;
  readonly body: ReadableStream<Uint8Array>;
  readonly started: Promise<StartedResponse>;
  readonly done: Promise<void>;

  private readonly startSettle: Deferred<StartedResponse>;
  private readonly doneSettle: Deferred<void>;
  private readonly headers = new Headers();
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private startedValue: StartedResponse | undefined;

  constructor() {
    super();
    this.startSettle = deferred<StartedResponse>();
    this.doneSettle = deferred<void>();
    this.started = this.startSettle.promise;
    this.done = this.doneSettle.promise;
    this.body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.destroy();
      },
    });
  }

  setHeader(name: string, value: string | readonly string[]): void {
    this.headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }

  getHeader(name: string): string | null {
    return this.headers.get(name);
  }

  getHeaders(): Headers {
    return new Headers(this.headers);
  }

  removeHeader(name: string): void {
    this.headers.delete(name);
  }

  getHeaderNames(): string[] {
    return [...this.headers.keys()];
  }

  writeHead(status: number, headers?: Record<string, string | readonly string[]>): this {
    this.statusCode = status;
    if (headers !== undefined) {
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    }
    this.settleStart();
    return this;
  }

  write(chunk: Uint8Array | string): boolean {
    if (this.writableEnded) throw new Error("dsh desktop: response already ended");
    this.settleStart();
    if (!this.destroyed) this.controller.enqueue(toBytes(chunk));
    return true;
  }

  end(chunk?: Uint8Array | string): this {
    if (this.writableEnded) return this;
    this.settleStart();
    if (chunk !== undefined && !this.destroyed) this.controller.enqueue(toBytes(chunk));
    this.writableEnded = true;
    if (!this.destroyed) this.controller.close();
    this.doneSettle.resolve();
    this.emit("finish");
    this.emit("close");
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (!this.writableEnded) {
      this.settleStart(500);
      this.controller.error(error ?? new Error("dsh desktop: response destroyed"));
      this.doneSettle.resolve();
    }
    this.emit("close");
    return this;
  }

  /** handler 抛错：未写头时以 500 收场，已写头则中断响应体。 */
  fail(error: unknown): void {
    if (this.destroyed) return;
    if (!this.headersSent) {
      this.statusCode = 500;
      this.settleStart();
      this.writableEnded = true;
      this.controller.enqueue(new TextEncoder().encode(errorMessage(error)));
      this.controller.close();
      this.doneSettle.resolve();
      return;
    }
    this.destroy(error instanceof Error ? error : new Error(String(error)));
  }

  private settleStart(forcedStatus?: number): void {
    if (this.startedValue !== undefined) return;
    this.headersSent = true;
    if (forcedStatus !== undefined) this.statusCode = forcedStatus;
    this.startedValue = { status: this.statusCode, headers: new Headers(this.headers) };
    this.startSettle.resolve(this.startedValue);
  }
}

function toBytes(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把一条 Fetch 请求合成 node 风格的 req/res，供注册在这些表上的 handler 使用。 */
function createRequest(request: Request, url: URL): IncomingMessage {
  const stream = Readable.from(request.body === null ? [] : consume(request.body));
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) headers[name.toLowerCase()] = value;
  return Object.assign(stream, {
    url: `${url.pathname}${url.search}`,
    method: request.method,
    headers,
    httpVersion: "1.1",
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    complete: false,
    aborted: false,
  }) as unknown as IncomingMessage;
}

async function* consume(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export class PortlessWebServer extends Service {
  static Config = z.object({
    host: z.union([z.const("127.0.0.1"), z.const("0.0.0.0")]).default("127.0.0.1"),
    port: z.natural().max(65535).default(0),
  });

  private readonly exact = new Map<string, WebRoute>();
  private readonly prefixes = new Map<string, WebRoute>();
  private readonly upgrades = new Map<string, WebUpgradeRoute>();
  private readonly indexTaps: ((html: string) => string)[] = [];
  private fallback: WebRoute["handler"] | undefined;

  constructor(ctx: Context, private readonly config: PortlessWebServerConfig) {
    super(ctx, "webServer");
  }

  /** 没有真实监听：报配置值（缺省 0），只用于拼展示用 URL。 */
  get port(): number {
    return this.config.port ?? 0;
  }

  get host(): string {
    return this.config.host ?? "127.0.0.1";
  }

  register(route: WebRoute): () => void {
    const table = route.kind === "exact" ? this.exact : this.prefixes;
    if (table.has(route.path))
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
    table.set(route.path, route);
    return () => {
      table.delete(route.path);
    };
  }

  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path))
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`);
    this.upgrades.set(route.path, route);
    return () => {
      this.upgrades.delete(route.path);
    };
  }

  registerFallback(handler: WebRoute["handler"]): () => void {
    if (this.fallback !== undefined) throw new Error("webserver: fallback already registered");
    this.fallback = handler;
    return () => {
      this.fallback = undefined;
    };
  }

  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform);
    return () => {
      const at = this.indexTaps.indexOf(transform);
      if (at !== -1) this.indexTaps.splice(at, 1);
    };
  }

  applyIndexTaps(html: string): string {
    let out = html;
    for (const transform of this.indexTaps) out = transform(out);
    return out;
  }

  collectIndexInjections(): IndexInjection[] {
    const table: IndexInjection[] = [];
    this.ctx.emit("webserver/index-inject", table);
    return table;
  }

  renderIndex(html: string): string {
    return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()));
  }

  /** 把一条管道请求分派给注册表；没有匹配也没有 fallback 时回 404。 */
  async dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    const handler = this.match(pathname)?.handler ?? this.fallback;
    if (process.env.DSH_DESKTOP_DEBUG === "1")
      console.error(`[dsh-desktop] dispatch ${request.method} ${pathname} → ${handler === undefined ? "404" : "handler"}`);
    if (handler === undefined) return new Response("not found", { status: 404 });
    const response = new SyntheticResponse();
    const req = createRequest(request, url);
    // handler 拥有响应生命周期；抛错由响应对象转成 500 或中断流。
    void Promise.resolve()
      .then(() => handler(req, response as unknown as ServerResponse))
      .catch((error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(errorMessage(error)));
        response.fail(error);
      });
    const started = await response.started;
    return new Response(response.body, { status: started.status, headers: started.headers });
  }

  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname);
    if (exact !== undefined) return exact;
    let best: WebRoute | undefined;
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      if (best === undefined || prefix.length > best.path.length) best = route;
    }
    return best;
  }
}

export default PortlessWebServer;
