// Remote 网关（host 半）：`/api` 的 RPC 拦截与 `/api/remote.mux` 的 WebSocket 升级都由它注册。
// 依赖按我们的规范显式 `inject`，随 `mount` 传给上游（上游构造里读 `ctx.connection` 也能拿到）。
import ApiGatewayPlugin from "@deepseek-ai/dsh-api-gateway";
import type { ConnectionRpcResult } from "@deepseek-ai/dsh-client-connection";
import { inject, Injectable, kFace, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Connection } from "../connection/contract.ts";
import { RemoteAccess } from "../remote-access/remote-access.contract.ts";
import { Typert } from "../typert/typert.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { TypertGateway, type InvokeRemoteRequest } from "../typert/gateway.contract.ts";

/**
 * 上游实例上我们够得到的那一条：`dispatchRpc` 在上游是私有方法（公开面只到 `invoke` / `stream`），
 * 而 `$events/result` 只有它会结算——所以自研载体按运行期形状取它，取不到就明说。
 */
interface UpstreamRpcDispatch {
  dispatchRpc(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    peer: InvokeRemoteRequest["peer"],
  ): Promise<ConnectionRpcResult<unknown>>;
}

@Injectable()
/**
 * 上游 `api/gateway` 的适配行。
 *
 * 它**就是** `typertGateway` 的实现（默认导出 `TypertGatewayService`，`super(ctx,'typertGateway')`）。
 * 契约只有 `TypertGateway` 一个：它同时是我们注入用的面，也是上游实现自己声明的那张面
 * （`ApiGateway` 那个自造契约没有消费者，已删——一个实现一个契约）。
 * descriptor 解析、lookup 解析、错误码映射都由它负责——我们不再自己写一份薄的。
 * 它靠 `ctx.reflect.props` 发现服务，这条由 `fromCordis.mount` 的**双注册**满足
 * （上游 `provide`/`Service` 的名字同时落到本行 cordis ctx）。
 */
@Injectable()
export class ApiGatewayDefault extends fromCordis(TypertGateway, ApiGatewayPlugin) {
  /**
   * 上游用它注册 `/api` 的 rpc 拦截与 `/api/remote.mux` 的 upgrade——两者都交回上游（见 `onInit`）。
   *
   * 仍是 optional：只装数据面的装配（纯端点测试）没有它们也能起来，那时上游那两段
   * `ctx.inject` 不回调，只是没有 wire 入口。
   */
  connection = inject.optional(Connection);

  webServer = inject.optional(WebServer);

  typert = inject(Typert);

  /**
   * 准入：**可选**。上游分派前按资源判定；只装数据面的装配（纯端点测试）没有它也能起来。
   */
  remoteAccess = inject.optional(RemoteAccess);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      // wire 载体交回上游：这两个名字齐了之后它自己注册 `/api` 的 rpc 拦截与
      // `/api/remote.mux` 的 upgrade（含它自己的 `RemoteStreamMuxServer`）。准入（缺认证那一档）
      // 由 `connection` 行放行，这里不重复判定。
      // **只交存在的面**：`mount` 按"deps 里有没有这个键"喂上游的 `ctx.inject`，交一个
      // `undefined` 它不会等，随即在 `connection.rpc` 上炸。
      ...(this.connection === undefined ? {} : { connection: this.connection }),
      ...(this.webServer === undefined ? {} : { webServer: this.webServer }),
      typert: this.typert,
      // **显式声明不可用**（值是 `undefined`）：`mount` 的校验按"键是否存在"判断，
      // 这样"本装配没有 remoteAccess"是明确的决定，而不是漏写。
      remoteAccess: this.remoteAccess,
    });
    // 载体入口补到**上游实例**上（装配器把令牌绑到它：`bindFace` 把契约值换成 `kFace`），
    // 所以注入方拿到的那份服务也有这一条。`dispatchRpc` 在上游是私有的，这里只做转发；
    // 答复进入 gateway 内部的 `remoteEventClients` 后，那条 waterfall 才会结算。
    const upstream = this[kFace] as UpstreamRpcDispatch | undefined;
    if (upstream === undefined || typeof upstream.dispatchRpc !== "function") {
      throw new Error("api-gateway: 上游实例没有 dispatchRpc，$events/result 无处结算");
    }
    Object.defineProperty(upstream, "dispatchWire", {
      value: async (
        endpoint: string,
        payload: unknown,
        signal: AbortSignal,
        peer: InvokeRemoteRequest["peer"],
      ): Promise<ConnectionRpcResult<unknown>> =>
        await upstream.dispatchRpc(endpoint, payload, signal, peer),
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }

  /**
   * 自研载体（mux）的 wire 入口：把一条原始载荷交给上游分派。
   *
   * 运行期由 `onInit` 挂到上游实例上（注入方看到的是那份实例），这里只是类型面。
   */
  declare readonly dispatchWire: TypertGateway["dispatchWire"];
}
