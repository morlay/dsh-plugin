// Remote 网关（host 半）：`/api` 的 RPC 拦截与 `/api/remote.mux` 的 WebSocket 升级都由它注册。
// 依赖按我们的规范显式 `inject`，随 `mount` 传给上游（上游构造里读 `ctx.connection` 也能拿到）。
import ApiGatewayPlugin from "@deepseek-ai/dsh-api-gateway";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Connection } from "../connection/contract.ts";
import { RemoteAccess } from "../remote-access/remote-access.contract.ts";
import { Typert } from "../typert/typert.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { ApiGateway } from "./api-gateway.contract.ts";

@Injectable()
export class ApiGatewayDefault extends fromCordis(ApiGateway, ApiGatewayPlugin) {
  connection = inject(Connection);

  webServer = inject(WebServer);

  typert = inject(Typert);

  remoteAccess = inject(RemoteAccess);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      // **不传 `connection` / `webServer`**：上游用这两个注册 `/api` 的 rpc 拦截与 `/api/remote.mux` 的 upgrade，
      // 而那条 upgrade 要求浏览器带认证 cookie（`admitConnection`）。我们的 mux 自己实现（`MuxServer`），
      // 上游那两段 `ctx.inject(['connection', 'webServer'], …)` 因此不执行，路径由我们独占。
      // （`connection` 是根 ctx 上的 host 服务名，只要不把 `webServer` 交出去，它就注册不了 upgrade。）
      typert: this.typert,
      remoteAccess: this.remoteAccess,
    });
  }
}
