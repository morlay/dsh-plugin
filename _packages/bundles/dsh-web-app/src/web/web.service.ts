import * as WebStartupPlugin from "@deepseek-ai/dsh-web-app/startup";
import { WebServer } from "@morlay/dsh-base/web-server";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis, jsExpr } from "@morlay/zephyr/compat";
import { WebStartupProvider, WebStartupToken } from "./web-startup.provider.ts";
import WebserverPlugin from "@deepseek-ai/dsh-host-webserver";
import * as WebRuntimeServicePlugin from "@deepseek-ai/dsh-web-app";


@Injectable()
export class Webserver extends fromCordis(WebServer, WebserverPlugin) {
  startup = inject(WebStartupToken);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      host: this.startup.host ?? "127.0.0.1",
      port: this.startup.port ?? 3080,
      tls: this.startup.tls,
      compression: "gzip",
      compressionLevel: 1,
      compressionThresholdBytes: 1024,
    });
    // 诊断：`/api/remote.mux` 的 upgrade 到底有没有走到注册的 handler（101 之后被关掉时唯一的线索）。
    const service = (this as unknown as { providerContext?: { webServer?: unknown } }).providerContext
      ?.webServer as
      | {
          registerUpgrade(route: {
            path: string;
            handler: (req: unknown, socket: unknown, head: unknown) => void;
          }): () => void;
        }
      | undefined;
    if (service !== undefined) {
      const original = service.registerUpgrade.bind(service);
      service.registerUpgrade = (route) => {
        process.stderr.write(`[web] upgrade route ${route.path}\n`);
        return original({
          ...route,
          handler: (req: unknown, socket: unknown, head: unknown) => {
            process.stderr.write(`[web] upgrade hit ${route.path}\n`);
            const ws = socket as { destroyed?: boolean; writable?: boolean; on?: Function };
            try {
              return route.handler(req, socket, head);
            } catch (error) {
              process.stderr.write(`[web] upgrade threw ${String(error)}\n`);
              throw error;
            } finally {
              setImmediate(() => {
                process.stderr.write(
                  `[web] upgrade settled destroyed=${String(ws.destroyed)} writable=${String(ws.writable)}\n`,
                );
              });
            }
          },
        });
      };
    }
  }
}

@Injectable()
export class WebRuntimeService extends fromCordis(WebRuntimeServicePlugin) {
  startup = inject(WebStartupToken);

  webServer = inject(WebServer);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      webServer: this.webServer,
      openBrowser: this.startup.openBrowser,
      printUrl: true,
      publicUrl: this.startup.publicUrl,
      surfaceContext: true,
    });
  }
}

// patch 行声明（`web-startup`）：官方 loader 形态由上游 startup 行按命令行发布 `webStartup`；
// 代码组合形态用 `WebStartupProvider` 直接提供值，所以这里不 mount（也就不会等 `cmdlineArgs`）。
@Injectable()
export class WebStartup extends fromCordis(WebStartupPlugin) {}
