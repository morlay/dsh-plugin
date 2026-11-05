// host 侧的连接面：我们的契约只有**传输**；上游实现内置了认证（`browser-auth`），
// 它需要上层给的 `Credentials`——我们只**转交**，不定义认证契约、不实现认证。
import type { IncomingMessage, ServerResponse } from "node:http";
import * as ConnectionPlugin from "@deepseek-ai/dsh-client-connection";
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";
import { Credentials } from "../credentials/credentials.contract.ts";
import { fromCordis } from "@morlay/zephyr/compat";
import { WebServer } from "../web/web-server.contract.ts";
import { Connection } from "./contract.ts";

/** `/api` 那一层的前缀（与上游 `createSharedFetchHandler(API_PATH)` 的 `API_PATH` 同值）。 */
const API_PREFIX = "/api";

/**
 * 上游的共享 fetch 分派器（`createSharedFetchHandler("/api")` 的产物）。
 *
 * 它不是我们的契约——我们只**转交**：谁往 `connection.fetch` 注册了 exact 路由
 * （上游 `ui-deliverables` 的四条交付物路由就是这么注册的），就该有人把 HTTP 请求喂给它。
 */
interface HostFetchHandler {
  readonly fetch: (request: Request, peer: unknown) => Promise<Response>;
}

/** 上游 `connection.rpc` 的两个注册面（`intercept` 是我们观测的那一条）。 */
interface RpcRegistry {
  readonly handle: (channel: string, handler: unknown) => () => Promise<void>;
  readonly intercept: (channel: string, matches: unknown, handler: unknown) => () => Promise<void>;
}

@Injectable()
export class ConnectionDefault extends fromCordis(Connection, ConnectionPlugin) {
  private readonly credentials = inject(Credentials);

  private readonly logger = inject(Logger);

  private readonly webServer = inject(WebServer);

  /** `/api` 前缀的注销函数（`onDispose` 里调）。 */
  private disposeApi: (() => void) | undefined;

  override async onInit(ctx: Context): Promise<void> {
    // 上游 `apply` 里用 `credentials.modifyRecord(...)` 维护浏览器 cookie；认证本身由上层提供。
    await this.mount(ctx, undefined, { credentials: this.credentials });
    // 上游是函数插件（`apply` 里 `new HostConnectionService` 再 `ctx.provide`）：没有 `providerInstance`，
    // 行内发布的 `connection` 就是那个服务实例——`ctx.get` 是拿它的唯一入口（cordis store 是唯一注册表）。
    const instance = (ctx as unknown as { get?: (n: string) => unknown }).get?.("connection");
    observeRpc(instance, this.logger);
    // 上游 `ClientRemoteService.$host` 无条件读 `connection.generation.getSnapshot()`：
    // 未连接时上游给的是 `undefined`，一渲染就炸。这里把 `generation` 收敛成**总是 observable**。
    const real = (
      instance as
        | {
            generation?: {
              getSnapshot?: () => unknown;
              subscribe?: (fn: () => void) => () => void;
            };
          }
        | undefined
    )?.generation;
    const fallback = { getSnapshot: () => ({ id: 0, host: undefined }), subscribe: () => () => {} };
    // 上游实例的 `generation` 是原型 getter：包一层自有属性，**未连接时**回落到兜底 observable。
    // **fetch 表的 HTTP 面**：上游 `ui-deliverables` 之类的行把 HTTP 路由注册进 `connection.fetch`，
    // 但那张表自己不会变成 HTTP 路由——上游是在 `ctx.inject(['webServer'], …)` 里挂一条 `/api` 前缀
    // 去服务它的。我们**不把 `webServer` 交给上游**（那会连带注册 `/api/<channel>` 的 rpc 分派与
    // 第二条 `/api/remote.mux` 的 upgrade，把本装配自己的 mux 那条链打断），只补这一段：
    // 一条 `/api` 前缀，把请求原样交给上游的共享分派器（exact 路由优先，其次才是 rpc 拦截器；
    // 两者都没有时它自己回 404）。少了这段，四条交付物路由（`/api/present.host` 等）在浏览器里
    // **永远是 404**，而装配期一切正常——这正是它藏了两轮的原因。
    //
    // **必须等 `connection` 出现再挂**：上游在 `apply` 里 `new HostConnectionService(...)` 才发布它，
    // 那个时机在 `mount` 返回之后（实测 `mount` 之后立刻 `ctx.get("connection")` 是 undefined）。
    // `ctx.inject` 对"已经存在的服务"是立即回调，对"稍后出现的"是等到出现——两种时机都正确。
    (
      ctx as unknown as {
        inject(
          names: readonly string[],
          callback: (scoped: unknown) => (() => void) | void,
        ): unknown;
      }
    ).inject(["connection"], (scoped) => {
      const live = (scoped as { get?: (n: string) => unknown }).get?.("connection");
      const shared = (
        live as { createSharedFetchHandler?: (channel: "/api") => HostFetchHandler } | undefined
      )?.createSharedFetchHandler?.("/api");
      if (shared === undefined) {
        // 上游换了形状时要立刻看见：`connection.fetch` 的路由没有这层分派就是永远 404。
        this.logger.warn(
          "[connection] 上游没有 createSharedFetchHandler：connection.fetch 注册的路由在 HTTP 上会 404",
        );
        return undefined;
      }
      this.disposeApi = this.mountFetchRoutes(shared);
      return () => {
        this.disposeApi?.();
        this.disposeApi = undefined;
      };
    });
    if (instance !== undefined) {
      Object.defineProperty(instance, "generation", {
        value: {
          getSnapshot: () =>
            typeof real?.getSnapshot === "function" ? real.getSnapshot() : fallback.getSnapshot(),
          subscribe: (fn: () => void) =>
            typeof real?.subscribe === "function" ? real.subscribe(fn) : fallback.subscribe(),
        },
        configurable: true,
      });
    }
  }

  /**
   * 把 `connection.fetch` 的表挂到 HTTP 宿主上。
   *
   * 只做转交：URL 与请求体原样过去，`Response` 原样回来。表里没注册的路径由上游自己回 404，
   * 这里不额外区分（多一层判断只会让「404 是没注册还是没数据」更难分）。
   * @param face - 上游的共享 fetch 分派器。
   * @returns 注销函数。
   */
  private mountFetchRoutes(face: HostFetchHandler): () => void {
    return this.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: async (req, res) => {
        try {
          await bridgeFetch(req, res, face);
        } catch (error) {
          // 单条请求失败不该把宿主带走：与 vite 那条转发同一个口径。
          this.logger.error("[connection] /api 的 fetch 分派失败：%s", String(error));
          if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          if (!res.writableEnded) res.end("connection.fetch 处理失败\n");
        }
      },
    });
  }

  override async onDispose(): Promise<void> {
    this.disposeApi?.();
    this.disposeApi = undefined;
  }
}

/** 调用方身份：本机宿主自己的界面通道（与 `MuxServer` 的 peer 同一口径）。 */
const OWNER_PEER = {
  id: "host",
  signal: new AbortController().signal,
  interactions: "answer" as const,
  principal: { kind: "owner" as const },
};

/**
 * 一条 node:http 请求 → WHATWG `Request` → `connection.fetch` → 写回 node 响应。
 *
 * 请求体**整份缓冲**：上游登记的 fetch 路由都是 `requestBody: "buffered"`；流式那条走的是
 * `/api/remote.mux` 的 upgrade，不经过这里。
 * @param req - node 请求。
 * @param res - node 响应。
 * @param face - 上游 fetch 面。
 */
async function bridgeFetch(
  req: IncomingMessage,
  res: ServerResponse,
  face: HostFetchHandler,
): Promise<void> {
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  const body = method === "GET" || method === "HEAD" ? undefined : await readAll(req);
  const url = "http://" + (req.headers.host ?? "127.0.0.1") + (req.url ?? "/");
  const request = new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body, duplex: "half" }),
  } as RequestInit);
  const response = await face.fetch(request, OWNER_PEER);
  const outHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    outHeaders[name] = value;
  });
  res.writeHead(response.status, outHeaders);
  if (method === "HEAD" || response.body === null) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** 读完请求体（`buffered` 路由要的形态）。 */
async function readAll(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

// `rpc` 是上游实例的 getter（每次读都给新对象），所以包在实例上：定义自有属性 shadow 原型 getter，
// 上游自己的调用与契约面读到的都是同一个包装对象。
function observeRpc(instance: unknown, logger: Logger): void {
  if (typeof instance !== "object" || instance === null) return;
  const connection = instance as { readonly rpc: RpcRegistry | undefined };
  const rpc = connection.rpc;
  if (rpc === undefined) return;
  const intercept = rpc.intercept;
  Object.defineProperty(connection, "rpc", {
    configurable: true,
    value: {
      handle: rpc.handle,
      intercept: (channel: string, matches: unknown, handler: unknown) => {
        logger.info("[rpc] %s", channel);
        return intercept(channel, matches, handler);
      },
    },
  });
}
