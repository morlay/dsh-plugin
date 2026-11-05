// Remote 网关（host 半）：`/api` 的 RPC 拦截与 `/api/remote.mux` 的 WebSocket 升级都由它注册。
// 依赖按我们的规范显式 `inject`，随 `mount` 传给上游（上游构造里读 `ctx.connection` 也能拿到）。
import ApiGatewayPlugin from "@deepseek-ai/dsh-api-gateway";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Connection } from "../connection/contract.ts";
import { RemoteAccess } from "../remote-access/remote-access.contract.ts";
import { Typert } from "../typert/typert.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { TypertGateway } from "../typert/gateway.contract.ts";

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
   * 上游用它注册 `/api` 的 rpc 拦截与 `/api/remote.mux` 的 upgrade——我们**不使用**那两条
   * （载体是自研 mux，准入自己判定），所以这里是 optional：本行不因为缺它们而装不上，
   * `mount` 也不会把这两个名字交给上游（它内部那两段 `ctx.inject` 因此不回调）。
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
      // **不传 `connection` / `webServer`**：上游用这两个注册 `/api` 的 rpc 拦截与 `/api/remote.mux` 的 upgrade，
      // 而那条 upgrade 要求浏览器带认证 cookie（`admitConnection`）。我们的 mux 自己实现（`MuxServer`），
      // 上游那两段 `ctx.inject(['connection', 'webServer'], …)` 因此不执行，路径由我们独占。
      // （`connection` 是根 ctx 上的 host 服务名，只要不把 `webServer` 交出去，它就注册不了 upgrade。）
      typert: this.typert,
      // **显式声明不可用**（值是 `undefined`）：`mount` 的校验按"键是否存在"判断，
      // 这样"本装配没有 remoteAccess"是明确的决定，而不是漏写。
      remoteAccess: this.remoteAccess,
    });
  }
}
