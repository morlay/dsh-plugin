import { watch } from "chokidar";
import { join } from "node:path";
// vite 的默认 handoff：懒建一次 dev server，参数全部从契约取（AppEnv / WebServer / Federation）。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { AppEnv } from "../app-env/app-env.contract.ts";
import { WebStartup } from "../web/web-startup.contract.ts";
import { Federation } from "../federation/federation.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { startViteDev, type ViteHandoff as StartedViteDev } from "../internal/serve-vite.ts";
import { ViteHandoff } from "./vite-handoff.contract.ts";

@Injectable()
export class ViteHandoffDefault extends ViteHandoff {
  private readonly appEnv = inject(AppEnv);

  private readonly startup = inject(WebStartup);

  private readonly federation = inject(Federation);

  private readonly webServer = inject(WebServer);

  private started: StartedViteDev | undefined;

  private starting: Promise<StartedViteDev> | undefined;

  protected async onInit(ctx: Context): Promise<void> {
    const options = {
      repoRoot: this.appEnv.values.profileDir,
      // 缓存落在数据根下的命名空间里（`<cacheDir>/vite`）：打包形态的 `profileDir` 只读。
      cacheDir: this.appEnv.cacheDirOf("vite"),
      appRoot: this.appEnv.appBootDir,
      base: "/",
      // **只收窄"当文件"的范围**：`include: []` 时全部预构建，页面仍由 vite 服务。
      devFiles: this.federation.config.dev.include,
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

  /**
   * 订阅服务端源码变化。
   *
   * **不用 vite 的 `server.watcher`**：它的 root 是 `appBootDir`（`apps/<app>/src/client`），
   * `packages/**` 根本不在监听范围——用它等于订阅了个空。
   * 这里开一个独立的 chokidar，精确盯 `packages/*<pkg>/src`，代价只有服务端那半的目录树。
   *
   * 判据是"**服务端那半**"：`src/client/**` 与 `src/ui/**` 由 vite 自己的 HMR 处理（改完浏览器自己热更），
   * 不该触发行的重载——那会把整条链的实例全换掉，反而更慢更乱。
   * @param listener - 收到变化的绝对路径。
   * @returns 撤销函数。
   */
  onServerSourceChange(listener: (file: string) => void): () => void {
    // 仓库根：`packageRoot` 是 `packages/zephyr/zephyr-app`，上三级就是它。
    // **不能用 `values.profileDir`**——那是应用自己的目录（`apps/<app>`），其下没有 `packages/`。
    const repoRoot = join(this.appEnv.packageRoot, "..", "..", "..");
    // **chokidar 4 不再支持 glob**（`watch(["…/*/*/src/**"])` 会 `ready` 但永不触发事件），
    // 只能盯目录 + `depth`：`packages/<group>/<pkg>/src` 是三层。
    const watcher = watch([join(repoRoot, "packages")], {
      ignoreInitial: true,
      depth: 3,
      ignored: ["**/node_modules/**", "**/__tests__/**"],
    });
    const handler = (file: string): void => {
      if (!isServerSource(file)) return;
      listener(file);
    };
    watcher.on("add", handler);
    watcher.on("change", handler);
    watcher.on("unlink", handler);
    return () => {
      void watcher.close();
    };
  }

  serve(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): boolean {
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

/**
 * 这个文件变了，需不需要重载**服务端**的行。
 *
 * 排除的是"客户端那半"：`src/client/**`（vite 的 HMR 自己处理）与 `src/ui/**`（浏览器端渲染面，
 * 同样走 vite）。它们变了去重载服务端行，等于把整条注入链的实例全换掉——比不生效更糟。
 * @param file - 变化的绝对路径。
 * @returns 属于服务端源码为 `true`。
 */
export function isServerSource(file: string): boolean {
  if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u.test(file)) return false;
  if (file.includes("/node_modules/")) return false;
  const normalized = file.replaceAll("\\", "/");
  if (normalized.includes("/src/client/")) return false;
  if (normalized.includes("/src/ui/")) return false;
  if (normalized.endsWith(".spec.ts") || normalized.endsWith(".spec.tsx")) return false;
  return normalized.includes("/src/");
}
