// 上游 `ui-open-in-app` 的 **host 半**（`@deepseek-ai/dsh-host-open-in-app`）：三条 HTTP 路由。
//
// 浏览器那次「打开方式」是一次 **HTTP 读**（`controller.ts` 的 `apps`），不是 remote 方法；
// 端点就在这个包里：`GET /open-in-app/apps`、`GET /open-in-app/icon…`、`POST /open-in-app/open`。
// 不装它的表现是——按钮在、点开是空的（读失败被静默当成空数组）。
//
// 上游的 `export const inject` 是 `['webServer', 'connection', 'subprocess']`：三个都按下文**显式交给上游**。
// 注意 `webServer` 是**上游服务名**（我们的派生名是 `web-server`），所以只能走 deps 交，不能指望 store 里有。
// 这条 deps 只作用在本行的 `apply` 内：它**不会**让 `connection` 那一行拿到 `webServer`，
// 因此**不会**触发上游 `/api` 的 rpc 分派注册（那条路我们仍然自己走 `ConnectionDefault` 的委托）。
import * as HostOpenInAppPlugin from "@deepseek-ai/dsh-host-open-in-app";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Connection, WebServer } from "@morlay/zephyr-app";
import { Subprocess } from "@morlay/dsh-shell";

/**
 * \`openInAppHost\` 的契约：这一行只注册 HTTP 路由，**不提供任何服务**。
 *
 * 写出来是为了让 \`fromCordis(契约, 实现)\` 的双参形态保持统一（装任何上游实现前先说清它的面）。
 */
@Injectable()
export abstract class OpenInAppHost {}

@Injectable()
export class OpenInAppHostRow extends fromCordis(OpenInAppHost, HostOpenInAppPlugin) {
  /**
   * 上游 `Config` 三个字段都是 `required()`（没有 schema 默认值）：不给就抛。
   *
   * 取值按「开发机上一条命令的容忍度」：探测目录 5s、抽图标 10s（要跑 `sips`/`plutil`）、
   * 启动观察窗 1.5s（超过就算已启动，进程继续留着）。
   */
  static readonly defaultConfig = {
    probeTimeoutMs: 5_000,
    iconTimeoutMs: 10_000,
    launchWatchMs: 1_500,
  };

  private readonly webServer = inject(WebServer);

  private readonly connection = inject(Connection);

  private readonly subprocess = inject(Subprocess);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      webServer: this.webServer,
      connection: this.connection,
      subprocess: this.subprocess,
    });
  }
}
