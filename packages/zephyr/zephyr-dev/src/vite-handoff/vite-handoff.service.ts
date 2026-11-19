import { watch } from "chokidar";
import { join } from "node:path";
// vite 的默认 handoff：懒建一次 dev server，参数全部从契约取（AppEnv / WebServer / Federation）。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { AppEnv, WebServer } from "@morlay/zephyr-app";
import { Federation } from "../federation/federation.contract.ts";
import type { Server as HttpServer } from "node:http";
import {
  startViteDev,
  type ViteDevOptions,
  type ViteHandoff as StartedViteDev,
} from "../internal/serve-vite.ts";
import { appBootDirOf, devPackageRoot } from "../internal/package-root.ts";
import { ViteHandoff } from "./vite-handoff.contract.ts";

/** vite dev server 的开关（装配面经 `configure(ViteHandoffDefault, …)` 给）。 */
export interface ViteHandoffOptions {
  /**
   * 客户端 HMR：`false` 时不挂 HMR 的 WebSocket（vite 的 `server.hmr = false`），
   * 并让 {@link ViteHandoff.hmr} 为 `false`——页面据此不注入 `/@vite/client`（见 `ServeDefault.replyPage`）。
   * 缺省开。
   */
  readonly hmr?: boolean;
}

@Injectable()
export class ViteHandoffDefault extends ViteHandoff {
  /**
   * @param options - 见 {@link ViteHandoffOptions}。
   */
  constructor(private readonly options: ViteHandoffOptions = {}) {
    super();
  }

  private readonly appEnv = inject(AppEnv);

  private readonly federation = inject(Federation);

  private readonly webServer = inject(WebServer);

  private started: StartedViteDev | undefined;

  private starting: Promise<StartedViteDev> | undefined;

  protected async onInit(ctx: Context): Promise<void> {
    const options: ViteDevOptions = {
      repoRoot: this.appEnv.values.profileDir,
      // 缓存落在数据根下的命名空间里（`<cacheDir>/vite`）：打包形态的 `profileDir` 只读。
      cacheDir: this.appEnv.cacheDirOf("vite"),
      appRoot: appBootDirOf(this.appEnv.values.profileDir),
      base: "/",
      // **只收窄"当文件"的范围**：`include: []` 时全部预构建，页面仍由 vite 服务。
      devFiles: this.federation.config.dev.include,
      // 客户端 HMR 的手动开关：关掉时 vite 不建 ws，页面也不注入客户端（排查问题时页面不再自己变）。
      hmr: this.options.hmr !== false,
      // HMR 的 WebSocket 挂在宿主的 http server 上（同源同端口）；vite 只读它的 `on('upgrade')`。
      // 我们的 `HttpHost` 是 node `http.Server` 的**子面**（`on` / `close` / `address` / `listen`），
      // 而 vite 的字段要那个名义类型：这里收窄一次（单断言，不是「把类型关掉」）。
      ...(this.webServer.server === undefined
        ? {}
        : { httpServer: this.webServer.server as HttpServer }),
      // HMR 的 WebSocket 要与页面**同源同端口**：这里只能是**实际监听端口**（`WebServer.port`）。
      // 期望端口（`WebStartup.values.port`，来自 `--port` / `PORT`）在被占用时会被宿主顺延——顺延后
      // 两者不等，客户端就会去连一个没人监听的端口（页面 console 满屏 ws 连接失败、HMR 整个失效）。
      // 0 表示还没 listen 完：这时不传，交给 `serve-vite` 从 `httpServer.address()` 读（或让 vite 用页面端口）。
      ...(this.webServer.port === 0 ? {} : { pagePort: this.webServer.port }),
      depsUrl: async (specifier: string, importer?: string) =>
        await this.federation.depsUrl(specifier, importer),
    };
    this.starting = startViteDev(ctx, options);
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
    // 仓库根：本包是 `packages/zephyr/zephyr-dev`，上三级就是它。
    // **不能用 `values.profileDir`**——那是应用自己的目录（`apps/<app>`），其下没有 `packages/`。
    const repoRoot = join(devPackageRoot(), "..", "..", "..");
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
