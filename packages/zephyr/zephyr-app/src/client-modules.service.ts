// 装配：`prefix /_zephyr/@modules` → Federation；`fallback` → WebServe；`upgrade /_zephyr/hmr` → vite 的 ws；按 AppEnv.remotes 装 remote。
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";
import { Remote } from "./remote.contract.ts";
import { AppEnv } from "./app-env.contract.ts";
import { ClientModules } from "./client-modules.contract.ts";
import { Federation } from "./federation/index.ts";
import { WebServe } from "./http/index.ts";
import { WebServer } from "./web/web-server.contract.ts";
import { ViteHandoff } from "./vite-handoff.contract.ts";
import { FEDERATION_PREFIX, HMR_PATH } from "./hmr-path.ts";
import { mountRemotes } from "./api-remotes/mount.ts";

/** 联邦地址的前缀（`/_zephyr/@modules/<pkg>@<ver>/<file>`）。 */

@Injectable()
export class ClientModulesDefault extends ClientModules {
  private readonly appEnv = inject(AppEnv);

  private readonly federation = inject(Federation);

  private readonly serve = inject(WebServe);

  private readonly vite = inject(ViteHandoff);

  /** Remote 服务（可选：没有装 `api-gateway` 的 client 半时它就是 undefined）。 */
  private readonly remote = inject.optional(Remote);

  private readonly logger = inject(Logger);

  private readonly webServer = inject(WebServer);

  private installed: (() => Promise<void>) | undefined;

  async install(): Promise<() => Promise<void>> {
    const disposePrefix = this.webServer.register({
      kind: "prefix",
      path: FEDERATION_PREFIX,
      handler: async (req, res) => {
        await this.federation.serve(req.url ?? "", req, res);
      },
    });
    const disposeFallback = this.webServer.registerFallback((req, res) => this.serve.handle(req, res));
    // HMR 的 upgrade：宿主 webserver 对**未注册**的路径会直接 destroy socket，所以这里必须注册一条
    // （否则 vite 的监听器还没机会跑，socket 已经断了）。handler 是空实现——真正完成握手的是 vite
    // 在同一个 http server 上的 upgrade 监听器（`hmr.server` + `vite-hmr` protocol）。
    const disposeUpgrade = this.webServer.registerUpgrade({
      path: HMR_PATH,
      handler: () => {},
    });
    // 路由表在**装配收尾**打印：只有这里知道路由是否都注册完了（`WebRuntimeService` 在前，表还是空的）。
    for (const route of this.webServer.routesOf()) {
      this.logger.info("[routes] %s %s", route.kind, route.path);
    }
    return async () => {
      disposeUpgrade();
      disposeFallback();
      disposePrefix();
    };
  }

  protected async onInit(_ctx: Context): Promise<void> {
    this.installed = await this.install();
    const remotes = this.appEnv.values.remotes ?? [];
    if (remotes.length === 0 || this.remote === undefined) return;
    await mountRemotes({ remote: this.remote }, remotes);
  }

  async onDispose(): Promise<void> {
    await this.installed?.();
    this.installed = undefined;
  }
}
