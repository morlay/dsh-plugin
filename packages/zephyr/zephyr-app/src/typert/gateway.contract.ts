// `TypertGateway` 的**宿主面抽象**（上游 `api/gateway` 的 `TypertGateway`，只取宿主真正用得到的成员）。
//
// 为什么要它：上游所有 `@Remote` 服务（`ApiSessionController`、workspace / settings / permission 的
// 控制器…）在构造时把自己注册进 `typert` 注册表，并指望 `ctx.typertGateway` 负责**分发**。
// 我们把 `typert` 注册表装了（`TypertRegistry`），差的就只有这个分发者——实现它，上游那些服务
// 就能原样装上，端点、流、投影推送全部免写。
//
// 不实现的东西（上游 `api/gateway` 里另外几块）：`/api` 的 HTTP 路由与 `admitConnection` 的准入。
// 那条路要 `BrowserAuth`（launch token + 签名 cookie），而我们的载体是自研 mux，准入由它自己做。
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";
import type { TypertGateway as UpstreamGateway } from "@deepseek-ai/dsh-api-gateway";

/**
 * 一次 Remote 调用（上游 `InvokeRemoteRequest`）。
 *
 * **直接取上游的类型**，不手抄字段：手抄漏过两次（`peer` 这种必需字段一漏，
 * 分派第一行就 `Cannot read properties of undefined (reading 'signal')`）。
 */
export type InvokeRemoteRequest = Parameters<UpstreamGateway["invoke"]>[0];

/** 一帧推给客户端的事件（上游 `PendingRemoteEventInfo` 的宿主视角）。 */
export interface PendingRemoteEventInfo {
  /** Event name. */
  readonly event: string;
  /** Agent the event belongs to. */
  readonly agentId: string;
}

/** 一段流：逐帧给出、带取消。 */
export type RemoteStream = AsyncIterable<unknown>;

/** 载体适配（上游 `wireStream` 的两条）。 */
export interface TypertGatewayWireStream {
  /**
   * 打开一条逻辑流。
   * @param endpoint - `namespace/method`。
   * @param payload - 载体解出来的载荷（`{ args }`）。
   * @param uplink - 客户端上行帧。
   * @param peer - 调用所代表的 peer（本装配只做占位）。
   * @param signal - 取消信号。
   * @returns 逐帧的值。
   */
  open(
    endpoint: string,
    payload: unknown,
    uplink: AsyncIterable<unknown>,
    peer: unknown,
    signal: AbortSignal,
  ): Promise<RemoteStream>;

  /**
   * 把一次失败折成载体能传的字段。
   * @param error - 打开或消费流时抛的错。
   * @returns 稳定的 code / message / details。
   */
  failure(error: unknown): {
    readonly code: string;
    readonly message: string;
    readonly details: object;
  };
}

/**
 * Host 级分发面（上游 `TypertGateway`）。
 *
 * **实现不在这里**：上游 `api/gateway` 的 `TypertGatewayService` 就是它（`super(ctx, 'typertGateway')`），
 * 由 `ApiGatewayDefault` 装上并发布。这里只声明契约 + 服务名，`inject(TypertGateway)` 按名字接到那个实例上。
 */
@Injectable()
export abstract class TypertGateway {
  /**
   * 上游注册名：`ctx.typertGateway`。
   *
   * 实现是上游 `api/gateway` 的 `TypertGatewayService`（由 `provideApiGateway()` 装上）；
   * 这个 `serviceName` 让令牌按名字绑到它（`mount` 的双注册 + 名字绑令牌）。
   */
  static readonly serviceName = "typertGateway";

  /** 载体适配：流式方法的打开与失败折叠。 */
  abstract readonly wireStream: TypertGatewayWireStream;

  /**
   * 调用一个 unary 方法。
   * @param request - 端点与命名参数。
   * @returns 业务结果（不做出参解码）。
   */
  abstract invoke(request: InvokeRemoteRequest): Promise<unknown>;

  /**
   * 打开一条流式方法。
   * @param request - 端点与命名参数。
   * @returns 逐帧的值。
   */
  abstract stream(request: InvokeRemoteRequest): Promise<RemoteStream>;

  /** 是否有活跃的客户端事件流（只有它能应答转发的 waterfall）。 */
  abstract hasLiveClient(): boolean;

  /** 尚未结算的转发事件（按到达顺序）。 */
  abstract getPendingRemoteEvents(): readonly PendingRemoteEventInfo[];

  /**
   * 登记转发事件的来源（上游 `registerRemoteEvents`）：客户端事件流从这里拿帧。
   * @param source - 事件流工厂。
   * @param host - 每代开帧里带的 Host 事实。
   * @returns 卸载函数。
   */
  abstract registerRemoteEvents(
    source: (...args: never[]) => AsyncIterable<unknown>,
    host: unknown,
  ): () => Promise<void>;
}

/** 覆盖守卫：上游 `TypertGateway` 有而本契约没列出的成员，编译期必须为空。 */
export type TypertGatewayCovered = AssertTrue<AssertCovered<UpstreamGateway, TypertGateway>>;
