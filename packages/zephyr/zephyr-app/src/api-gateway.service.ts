// Remote 网关（host 半）：`/api` 的 RPC 拦截与 `/api/remote.mux` 的 WebSocket 升级都由它注册。
// 依赖按我们的规范显式 `inject`，随 `mount` 传给上游（上游构造里读 `ctx.connection` 也能拿到）。
import ApiGatewayPlugin from "@deepseek-ai/dsh-api-gateway";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Connection } from "./connection/contract.ts";
import { RemoteAccess } from "./remote-access.contract.ts";
import { Typert } from "./typert.contract.ts";
import { WebServer } from "./web/web-server.contract.ts";

@Injectable()
export class ApiGatewayDefault extends fromCordis(ApiGatewayPlugin) {
  connection = inject(Connection);

  webServer = inject(WebServer);

  typert = inject(Typert);

  remoteAccess = inject(RemoteAccess);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      connection: this.connection,
      webServer: this.webServer,
      typert: this.typert,
      remoteAccess: this.remoteAccess,
    });
  }
}
