// host 侧的连接面：我们的契约只有**传输**。上游的实现（认证注册表 + 连接服务）由本行**显式** `new`：
// 走它的 `apply` 会把服务注册推迟到上游自己的 `ctx.inject` 回调之后（0.2.3），本行就拿不到实例。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ConnectionAuthentication,
  HostConnectionService,
} from "@deepseek-ai/dsh-client-connection";
import type {
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionTrustRequest,
  PeerAdmission,
  PeerScope,
} from "@deepseek-ai/dsh-client-connection";
import {
  inject,
  Injectable,
  Logger,
  type Context,
  type OnDispose,
  type OnInit,
} from "@morlay/zephyr";
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

/** 上游 `connection.rpc` 的两个注册面：`intercept` 是**共享**通道，一条通道只有一个物理拦截器。 */
interface RpcRegistry {
  readonly handle: (channel: string, handler: ConnectionRpcHandler) => () => Promise<void>;
  readonly intercept: (
    channel: "/api",
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ) => () => Promise<void>;
}

/** 共享通道上的一个拦截项：认领哪些端点、认领之后怎么处理。 */
interface RpcInterceptorEntry {
  readonly matches: ConnectionRpcEndpointMatcher;
  readonly handler: ConnectionRpcHandler;
}

/** 一条共享通道：拦截项清单，加上它**唯一**那个物理拦截器的注销函数。 */
interface SharedRpcChannel {
  readonly entries: RpcInterceptorEntry[];
  dispose: (() => Promise<void>) | undefined;
}

/**
 * 上游的信任围栏（`connection.requestRejection`）：Host / Origin 不是本机就给状态码。
 *
 * 围栏只认**原始请求头**——`Request` 构造会把 `origin` / `sec-*` / `host` 这些 forbidden header
 * 丢掉，所以这一层必须在 node 的 `req` 上做，不能挪进 fetch 桥。
 */

/**
 * 上游 `HostConnectionService` 的子类：唯一目的是把 `trustedHosts` 固定成 `[]`。
 *
 * `fromCordis` 的 Service 分支按 `(ownerCtx, effectiveConfig)` 构造上游类，而 `HostConnectionService`
 * 的第二参是 `trustedHosts` 而不是 config（传 config 进去它会 `undefined.some`）。这一层把签名收成
 * 一个参数，`fromCordis` 传进来的第二参被忽略。
 */
class HostConnection extends HostConnectionService {
  /** @param ctx - 装这一行的 ctx（`fromCordis` 的 deps 代理）。 */
  constructor(ctx: CordisContext) {
    // 上游构造里 `this.authentication = ctx['connection.authentication']`（严格读）：注册表要先在。
    // `super` 之前建它不碰 `this`，是合法的。
    new ConnectionAuthentication(ctx);
    super(ctx, []);
  }
}

@Injectable()
export class ConnectionDefault
  extends fromCordis(Connection, HostConnection)
  implements OnInit, OnDispose
{
  private readonly logger = inject(Logger);

  private readonly webServer = inject(WebServer);

  /** `/api` 前缀的注销函数（`onDispose` 里调）。 */
  private disposeApi: (() => void) | undefined;

  /**
   * `mount` 拿到上游实例后，把两条补丁与 `/api` 前缀显式装好。
   *
   * `webServer` 是我们的外部依赖：上游按 `webServer` 这个名字读 carrier（信任围栏拿 host / protocol），
   * 所以作为 deps 交进去。
   */
  async onInit(ctx: Context): Promise<void> {
    const connection = (await this.mount(ctx, undefined, {
      webServer: this.webServer,
    })) as HostConnectionService;
    // 两条补丁**在任何 `rpc.intercept` 之前**装上：一条通道只容一个物理拦截器（上游对第二个直接抛）。
    shareRpcChannels(connection, this.logger);
    admitLocalPeer(connection, this.logger);
    // **fetch 表的 HTTP 面**：上游 `ui-deliverables` 之类的行把 HTTP 路由注册进 `connection.fetch`，
    // rpc 面则由 `api-gateway` 的 `rpc.intercept('/api', …)` 接管，但两条都只是表——把 HTTP 请求喂进去的
    // `/api` 前缀归载体，就是这一段（exact 路由优先、其次 rpc 拦截器、都没有时上游自己回 404）。
    // 少了这段，四条交付物路由在浏览器里永远是 404，而装配期一切正常。
    const shared = connection.createSharedFetchHandler(API_PREFIX);
    this.disposeApi = this.mountFetchRoutes(shared, connection);
  }

  /**
   * 把 `connection.fetch` 的表挂到 HTTP 宿主上。
   *
   * 只做转交：URL 与请求体原样过去，`Response` 原样回来。表里没注册的路径由上游自己回 404，
   * 这里不额外区分（多一层判断只会让「404 是没注册还是没数据」更难分）。
   *
   * **先过信任围栏**：上游的 `createSharedFetchHandler` 不做准入（它假定载体已经准入过），
   * 而 `rpc.intercept('/api', …)` 让整个 rpc 面从这条前缀可达——不查就是任何网页都能读写本机宿主。
   * @param face - 上游的共享 fetch 分派器。
   * @param trust - 上游的信任围栏（拿不到时只留 warn，不静默降级成"谁都放行"的假象）。
   * @returns 注销函数。
   */
  private mountFetchRoutes(face: HostFetchHandler, connection: HostConnectionService): () => void {
    return this.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: async (req, res) => {
        // 准入与取 peer 是同一次判定：HTTP 的 peer 必须与 WS 事件流用的是**同一个实例**，
        // 否则 `$events/result` 会被上游判成「另一个 Peer」的答复。
        const admission = connection.admit(trustRequestOf(req));
        if ("rejection" in admission) {
          const rejection = admission.rejection;
          res.writeHead(rejection, { "content-type": "text/plain; charset=utf-8" });
          res.end(rejection === 401 ? "unauthorized" : "forbidden");
          return;
        }
        const peer = admission.peer;
        try {
          await bridgeFetch(req, res, face, peer);
        } catch (error) {
          // 单条请求失败不该把宿主带走：与 vite 那条转发同一个口径。
          this.logger.error("[connection] /api 的 fetch 分派失败：%s", String(error));
          if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          if (!res.writableEnded) res.end("connection.fetch 处理失败\n");
        }
      },
    });
  }

  async onDispose(): Promise<void> {
    this.disposeApi?.();
    this.disposeApi = undefined;
  }
}

/**
 * 一条 node:http 请求 → WHATWG `Request` → `connection.fetch` → 写回 node 响应。
 *
 * 请求体**整份缓冲**：上游登记的 fetch 路由都是 `requestBody: "buffered"`；流式那条走的是
 * `/api/remote.mux` 的 upgrade，不经过这里。
 * @param req - node 请求。
 * @param res - node 响应。
 * @param face - 上游 fetch 面。
 */
/**
 * node 请求（HTTP 或 upgrade）→ 上游的信任请求面（`admit` 的入参）：载体原样，header 表 / 方法 / 目标 / socket。
 * @param req - node 请求。
 * @returns 上游 `ConnectionTrustRequest`。
 */
export function trustRequestOf(req: IncomingMessage): ConnectionTrustRequest {
  return { headers: req.headers, method: req.method, url: req.url, socket: req.socket };
}

async function bridgeFetch(
  req: IncomingMessage,
  res: ServerResponse,
  face: HostFetchHandler,
  peer: unknown,
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
  const response = await face.fetch(request, peer);
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

/**
 * 把上游 `admit` 的「缺认证」一档放行成本机界面通道的 peer。
 *
 * 上游把准入拆成两条判据：Host / Origin 不信任给 `403`，缺凭据给 `401`。本机部署不设认证，
 * 只把 `401` 换成上游自己那份浏览器 owner peer；`403` 与已认证凭据的结果原样返回。
 * `admitConnection`（upgrade 准入）与 `requestRejection` 都经 `this.admit`，所以只 shadow 这一个成员。
 * @param instance - 上游 `connection` 服务实例（`ctx.get("connection")` 拿到的那个）。
 * @param logger - 行日志出口：缺面时留一条 warn（症状是浏览器连不上 wire，离装配点很远）。
 */
export function admitLocalPeer(instance: unknown, logger: Logger): void {
  if (typeof instance === "object" && instance !== null) {
    // 幂等：重复包会把已经影子过的 `admit` 再包一层。
    if (admitInstalled.has(instance)) return;
    admitInstalled.add(instance);
  }
  const upstream =
    typeof instance === "object" && instance !== null
      ? (instance as {
          admit?: (request: ConnectionTrustRequest) => PeerAdmission;
          readonly browserPeer?: PeerScope;
        })
      : undefined;
  const admit = upstream?.admit;
  const browserPeer = upstream?.browserPeer;
  if (upstream === undefined || typeof admit !== "function" || browserPeer === undefined) {
    logger.warn("[connection] 上游没有 admit / browserPeer：缺认证的那一档不会被放行");
    return;
  }
  Object.defineProperty(upstream, "admit", {
    configurable: true,
    value: (request: ConnectionTrustRequest): PeerAdmission => {
      const admission = admit.call(upstream, request);
      return "rejection" in admission && admission.rejection === 401
        ? { peer: browserPeer }
        : admission;
    },
  });
}

/**
 * 把 `connection.rpc` 换成**可叠加**的拦截器注册面。
 *
 * 上游的共享通道一条只容一个物理拦截器（第二个注册直接抛），而 `/api` 上有两个贡献方：
 * 上游 `api-gateway` 认领它自己 typert 注册表里的端点，装配层的 Remote 路由桥认领自研组。
 * 这里把物理那一个做成**按注册顺序取第一个命中项**：先注册的先问，`$events/result` 这类
 * 上游专有的端点因此仍归上游。
 *
 * 必须装在上游首次注册**之前**（`ConnectionDefault.onInit` 里 `mount` 之后立刻调）：
 * 物理拦截器一旦落在别人手里，它的处理器是闭包捕获的，我们拿不到也换不掉。
 * `rpc` 是上游实例的 getter（每次读都给新对象），所以包在实例上：定义自有属性 shadow 原型 getter，
 * 上游自己的调用与契约面读到的都是同一个包装对象。
 * @param instance - 上游 `connection` 服务实例。
 * @param logger - 行日志出口（每次注册留一条登记）。
 */
/** 已经装过共享层的实例（幂等守卫）。 */
const sharedInstalled = new WeakSet<object>();

/** 已经影子过 `admit` 的实例（幂等守卫）。 */
const admitInstalled = new WeakSet<object>();

export function shareRpcChannels(instance: unknown, logger: Logger): void {
  if (typeof instance !== "object" || instance === null) return;
  // 幂等：重复装会把 entries 清空、再给上游装第二个物理拦截器（上游直接抛 already has an interceptor）。
  if (sharedInstalled.has(instance)) return;
  sharedInstalled.add(instance);
  const connection = instance as { readonly rpc: RpcRegistry | undefined };
  const rpc = connection.rpc;
  if (rpc === undefined) return;
  const { handle, intercept } = rpc;
  const channels = new Map<string, SharedRpcChannel>();
  /** 取（或建）一条通道的拦截项清单。 */
  const channelOf = (channel: string): SharedRpcChannel => {
    const opened = channels.get(channel);
    if (opened !== undefined) return opened;
    const created: SharedRpcChannel = { entries: [], dispose: undefined };
    channels.set(channel, created);
    return created;
  };
  Object.defineProperty(connection, "rpc", {
    configurable: true,
    value: {
      handle,
      intercept: (
        channel: "/api",
        matches: ConnectionRpcEndpointMatcher,
        handler: ConnectionRpcHandler,
      ): (() => Promise<void>) => {
        const shared = channelOf(channel);
        const entry: RpcInterceptorEntry = { matches, handler };
        shared.entries.push(entry);
        if (shared.dispose === undefined) {
          try {
            shared.dispose = intercept(
              channel,
              // 物理拦截器只回答「这条通道上有没有人认领」；谁认领由清单定。
              (endpoint) => shared.entries.some((candidate) => candidate.matches(endpoint)),
              async (endpoint, payload, signal, peer) => {
                const owner = shared.entries.find((candidate) => candidate.matches(endpoint));
                // 注册在 matcher 与 handler 之间被撤销：上游同一条路径给 404，这里给同口径的失败面。
                if (owner === undefined) {
                  return {
                    ok: false,
                    error: {
                      code: "gateway/bad-request",
                      message: `${channel}/${endpoint} 没有拦截项认领`,
                      details: {},
                    },
                  };
                }
                return await owner.handler(endpoint, payload, signal, peer);
              },
            );
          } catch (error) {
            shared.entries.splice(shared.entries.indexOf(entry), 1);
            throw error;
          }
        }
        logger.info("rpc 拦截：%s", channel);
        return async () => {
          const index = shared.entries.indexOf(entry);
          if (index >= 0) shared.entries.splice(index, 1);
          if (shared.entries.length > 0) return;
          const dispose = shared.dispose;
          shared.dispose = undefined;
          channels.delete(channel);
          await dispose?.();
        };
      },
    },
  });
}
