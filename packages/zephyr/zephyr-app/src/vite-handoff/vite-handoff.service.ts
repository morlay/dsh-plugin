// vite 的默认 handoff：懒建一次 dev server，参数全部从契约取（AppEnv / ClientRows）。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { AppEnv } from "../app-env/app-env.contract.ts";
import { WebStartup } from "../web/web-startup.contract.ts";
import { Federation } from "../federation/federation.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { ClientRows } from "../rows/index.ts";
import { startViteDev, type ViteHandoff as StartedViteDev } from "../internal/serve-vite.ts";
import { ViteHandoff } from "./vite-handoff.contract.ts";

@Injectable()
export class ViteHandoffDefault extends ViteHandoff {
  private readonly appEnv = inject(AppEnv);

  private readonly startup = inject(WebStartup);

  private readonly rows = inject(ClientRows);

  private readonly federation = inject(Federation);

  private readonly webServer = inject(WebServer);

  private started: StartedViteDev | undefined;

  private starting: Promise<StartedViteDev> | undefined;

  protected async onInit(ctx: Context): Promise<void> {
    const options = {
      repoRoot: this.appEnv.values.profileDir,
      appRoot: this.appEnv.appBootDir,
      base: "/",
      rows: { rows: async () => new Map(this.rows.clientPaths) },
      aggregate: this.appEnv.values.aggregate ?? [],
      // HMR 的 WebSocket 挂在宿主的 http server 上（同源同端口）；vite 只读它的 `on('upgrade')`，
      // 类型上按最小面断言一次（我们的 `HttpHost` 与 vite 的 `HmrServer` 不共享名义类型）。
      ...(this.webServer.server === undefined
        ? {}
        : { httpServer: this.webServer.server as unknown as { on(...args: never[]): unknown } }),
      ...(this.startup.values.port === undefined || this.startup.values.port === 0
        ? {}
        : { pagePort: this.startup.values.port }),
      depsUrl: async (specifier: string, importer?: string) =>
        await this.federation.depsUrl(specifier, importer),
    };
    this.starting = startViteDev(
      ctx as never,
      options as unknown as Parameters<typeof startViteDev>[1],
    );
    // 「挂住」不该无声：30s 没起来就明确报错（dev server 挂起时装配会一直等着）。
    this.started = await Promise.race([
      this.starting,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("vite dev server 30s 内没有就绪")), 30_000),
      ),
    ]);
  }

  get hmr(): boolean {
    return this.started?.hmr === true;
  }

  serve(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean {
    return this.started?.serve(req, res) ?? false;
  }


  async transformHtml(html: string): Promise<string> {
    const started = this.started ?? (await this.starting);
    return await (started?.transformHtml(html) ?? html);
  }

  async dispose(): Promise<void> {
    // `startViteDev` 返回的 handoff 没有 dispose（vite 的 server 由它自己按需重启），这里只清引用。
    this.started = undefined;
  }
}
