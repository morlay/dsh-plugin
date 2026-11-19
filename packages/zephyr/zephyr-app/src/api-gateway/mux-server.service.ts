// `/api/remote.mux` 的宿主半：**协议与连接交给上游**，这里只提供分流。
//
// 上游那份 `RemoteStreamMuxServer` 已经有心跳探活、`permessage-deflate`、uplink 窗口上限、帧协议
// 与 peer 绑定；自己再写一份的结果是两份 upgrade 并存，而 `WebServer` 的 upgrade 分派先注册先赢——
// 先注册的上游拿到连接，自研那份（含自研路由表的分流）从来没接到过 open，自研流式端点因此在真机上
// 没有 wire 入口。
//
// 所以：upgrade 由本行接管（上游 `api-gateway` 的装配不再交给它 `webServer`，见 `ApiGatewayDefault`），
// 但**协议实现换回上游的类**，分派点从它的构造参数注入：
//   自研路由表的流式端点（`RemoteHandlers.stream`）→ 上游 gateway 的 `wireStream.open`
import { RemoteStreamMuxServer } from "@deepseek-ai/dsh-api-gateway/src/stream-server.ts";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { inject, Injectable, Logger, type Context, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "./remote-handlers.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { TypertGateway, type InvokeRemoteRequest } from "../typert/gateway.contract.ts";

/** mux 的路径（与客户端 `muxTransport` 一致）。 */
const MUX_PATH = "/api/remote.mux";

/** 上游分派要的 peer 面（`InvokeRemoteRequest` 的那一项）。 */
type PeerScope = InvokeRemoteRequest["peer"];

/**
 * 上游 `connection` 的**准入面**（宿主侧）：upgrade 由它判定并给出这次连接代表的 peer。
 *
 * 我们的 `Connection` 契约只有浏览器那一面，所以这里按运行期形状取（与 `ConnectionDefault`
 * 读 `admit` / `generation` 同一口径）。
 */
interface HostAdmission {
  readonly admitConnection: (
    request: IncomingMessage,
  ) =>
    | { readonly rejection: number }
    | { readonly peer: PeerScope; readonly release: () => Promise<void> };
}

/** 上游 mux 的连接参数（默认值与上游 `Config` 一致）。 */
interface MuxOptions {
  /** WebSocket Ping 间隔（毫秒）。 */
  readonly heartbeatIntervalMs: number;
  /** 一条逻辑流允许缓冲的上行字节数。 */
  readonly streamInboxBytes: number;
  /** 是否协商 `permessage-deflate`。 */
  readonly compression: boolean;
}

/** 上游 `Config` 的默认值：部署变了才改，改的时候与上游保持同一份口径。 */
const DEFAULT_OPTIONS: MuxOptions = {
  heartbeatIntervalMs: 2_000,
  streamInboxBytes: 262_144,
  compression: true,
};

@Injectable()
export class MuxServer implements OnDispose {
  /** Remote 方法的路由表：谁提供服务谁注册，不经过全局服务名。 */
  private readonly handlers = inject(RemoteHandlers);

  /** 上游 `typertGateway`：上游 `@Remote` 端点的分派面。 */
  private readonly gateway = inject(TypertGateway);

  private readonly webServer = inject(WebServer);

  private readonly logger = inject(Logger);

  /** 上游的协议实现（心跳 / 压缩 / 帧 / uplink 窗口）：`onInit` 里建（构造期注入还没解析）。 */
  private mux: RemoteStreamMuxServer | undefined;

  private disposeRoute: (() => void) | undefined;

  /** 开着的逻辑流数（dev 的 HMR 空闲判据的另一半）。 */
  private liveStreams = 0;

  /** 在途的 unary 调用数。 */
  private inFlightCalls = 0;

  /**
   * 一条逻辑流的来源：**自研路由表优先**，没有实现才回落到上游 gateway。
   *
   * 自研那份是同步就绪的帧序列（`RemoteHandlers.registerStream`），上游那份要按 descriptor
   * 走 typert 的 lookup 与 binding 校验。两边的取消信号是同一个 `control.signal`。
   * @param endpoint - `namespace/method`。
   * @param payload - 载体解出来的载荷（`{ args }`）。
   * @param uplink - 客户端上行帧（双向流才读）。
   * @param peer - 这次连接代表的 peer。
   * @param control - 逻辑流控制器（abort 即取消）。
   * @returns 帧序列。
   */
  private async open(
    endpoint: string,
    payload: unknown,
    uplink: AsyncIterable<unknown>,
    peer: PeerScope,
    control: AbortController,
  ): Promise<AsyncIterable<unknown>> {
    const args = (payload as { args?: Record<string, unknown> } | undefined)?.args ?? {};
    const own = this.handlers.stream(endpoint, args, control.signal, uplink);
    if (own !== undefined) return own;
    return await this.gateway.wireStream.open(endpoint, payload, uplink, peer, control.signal);
  }

  onInit(ctx: Context): void {
    this.mux = new RemoteStreamMuxServer(
      async (endpoint, payload, uplink, peer, control) => {
        this.liveStreams += 1;
        try {
          return await this.open(endpoint, payload, uplink, peer, control);
        } catch (error) {
          this.liveStreams = Math.max(0, this.liveStreams - 1);
          throw error;
        }
      },
      // 包一层而不是直接取方法：上游那个成员读实例状态，脱离实例调用会丢 this。
      (error: unknown) => this.gateway.wireStream.failure(error),
      DEFAULT_OPTIONS,
    );
    this.disposeRoute = this.webServer.registerUpgrade({
      path: MUX_PATH,
      handler: (req, socket, head) => {
        this.accept(ctx, req, socket, head);
      },
    });
  }

  async onDispose(): Promise<void> {
    this.disposeRoute?.();
    this.disposeRoute = undefined;
    await this.mux?.close();
  }

  /**
   * 服务端此刻是否**空闲**：没有在途 unary、没有开着的流。
   *
   * 开发态的**服务端 HMR** 靠它决定"现在能不能 reload"——有在途调用时换掉整棵行树，
   * 那条请求会拿到半新半旧的对象图，比直接报错更难查。
   * @returns 空闲为 `true`。
   */
  inFlight(): number {
    return this.inFlightCalls + this.liveStreams;
  }

  /**
   * 一次 upgrade：先过准入（上游 `admitConnection`，本机免认证由 `connection` 行放行），
   * 再把 socket 交给上游的 mux。
   * @param ctx - 行 ctx（准入面按名字取上游实例）。
   * @param req - upgrade 请求。
   * @param socket - 交接的 socket。
   * @param head - 已读字节。
   */
  private accept(ctx: Context, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const host = ctx.get("connection", false);
    const admission = (host as HostAdmission | undefined)?.admitConnection;
    if (typeof admission !== "function") {
      // 没有准入面就不该接连接：放行等于把宿主暴露给任何页面。
      this.logger.warn("[mux] 上游没有 admitConnection：这次的 upgrade 直接断开");
      socket.destroy();
      return;
    }
    const result = admission.call(host, req);
    if ("rejection" in result) {
      socket.destroy();
      return;
    }
    const release = (): void => {
      void result.release().catch((error: unknown) => {
        this.logger.warn("[mux] peer 释放失败：%s", String(error));
      });
    };
    socket.once("close", release);
    try {
      this.mux?.handleUpgrade(req, socket, head, result.peer);
    } catch (error) {
      release();
      socket.destroy();
      this.logger.warn("[mux] upgrade 失败：%s", String(error));
    }
  }
}
