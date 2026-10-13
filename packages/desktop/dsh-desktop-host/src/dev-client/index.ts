import { appendFile, mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import { HMR_PATH, startViteDev } from "./serve-vite.ts";
import {
  clientHalfOf,
  exportTargetOf,
  manifestOf,
  packageRootOf,
  parsePluginAddress,
  PLUGIN_ROUTE,
  resolveInPackage,
} from "./modules.ts";

export const name = "dev-client-bundles";

export const inject = ["loader", "webServer"];


// 打包器（`@local/devkit` 的现场打包面，连带 rolldown 与它的原生绑定）按需加载：打包产物里的行
// 已经切成 dist，这一支一次都不会走——常驻它等于给每个宿主进程白加一份打包器的内存。
interface RouteHost {
  /** 把注入表（boot 数据、引导器、script 行）渲染进一份 index.html 骨架。 */
  renderIndex(html: string): string;
  /** 注册一条**升级**路由（WebSocket 之类）；未注册的升级请求会被上游直接 destroy。 */
  registerUpgrade(route: {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  }): () => void;
  registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void): () => void;
  register(route: {
    // `prefix` 匹配 `p` 与 `p/<anything>`（上游 webServer 的原生能力）：按文件寻址要用它。
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}


/** CJS 包的具名导出补全。
 *
 * `react` 这类包的入口是 `module.exports = require('./cjs/…')`，rolldown 静态分析不出具名导出，产物只带
 * `export default require_react()`——而浏览器侧要 `import { Fragment } from "react"`，于是**整个 import
 * 阶段就失败**（入口一行都执行不了）。这里按 CJS 对象的键补一段**静态** `export const`（ESM 的导出必须
 * 静态可枚举，不能 `export * from` 一个运行期对象）。
 */
/**
    return [];
  }
  const names = new Set<string>();
  for (const match of raw.matchAll(/(?:from|require\()\s*["']([^"']+)["']/gu)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) continue;
    names.add(packageNameOf(specifier));
  }
  return [...names];
}

/** 目录判定（找不到就是 false，不抛）。 */

/** cordis Loader 条目里我们用到的那几项（上游 `client-modules` 用同样几个字段判断行）。 */
interface LoaderEntry {
  disabled?: boolean;
  fiber?: unknown;
  options?: { name?: string };
  /** 该 entry 的解析基：Loader 用它解析插件名（上游 `client-modules` 的 `resolveSource` 读的就是这里）。 */
  parent?: { tree?: { ctx?: { baseUrl?: string } } };
}

/** 一行 client 声明：包名与它的 client 半源文件。 */
export interface ClientRow {
  id: string;
  clientPath: string;
}

/**
 * 行清单：**cordis Loader 的 entries** 里声明了 `dsh.client` 的那些包——**上游 `client-modules` 的同一份
 * 来源**（"装配的真相"，任何项目/上游都通用），`disabled` 的行在这里被跳过（profile 的开关就此生效）。
 *
 * 每行给出**包名**与该包 **client 半的源文件**。包的位置用 **entry 自己的 `parent.tree.ctx.baseUrl`**
 * 解析（上游 `resolveSource`/`resolveMeta` 用的就是它）——从进程的 cwd 解析不到这些包：pnpm 的严格布局
 * 下它们只在各自消费者的 node_modules 里，profile 的运行时目录又另有一套。
 *
 * **判据是清单里的 `dsh.client` 声明**（与上游 `client-modules` 同源）：光有 `src/client/` 目录不算行——
 * 上游有若干包只是"宿主插件 + 一份 client 半"（`@deepseek-ai/dsh-session-title` 那种），它们由真正的行在
 * 自己的 client 半里 import，不该出现在装配清单里；混进来就会多装配一次（`apply` 里那些"同 namespace 的
 * locale 已注册"的报错就是这么来的），也会在入口打出一串 `skip (no apply/default)`。
 */
async function clientRowsOf(loader: { entries(): Generator<LoaderEntry> }): Promise<ClientRow[]> {
  const found = new Map<string, ClientRow>();
  // `entries()` 是生成器（cordis 的 Loader 就是这么给的），直接迭代即可。
  for (const entry of loader.entries()) {
    if (entry.disabled === true || entry.fiber === undefined) continue;
    const name = entry.options?.name;
    if (typeof name !== "string" || name === "") continue;
    // 虚拟入口（`cordis:include`、`<插件>:<组>`）不是包名。
    if (name.includes(":")) continue;
    if (found.has(name)) continue;
    const baseUrl = entry.parent?.tree?.ctx?.baseUrl;
    if (baseUrl === undefined) continue;
    const resolved = await packageRootOf(baseUrl, name);
    if (resolved === undefined) continue;
    const manifest = await manifestOf(resolved.root);
    const declared = (manifest as { dsh?: { client?: unknown } } | undefined)?.dsh?.client;
    if (manifest === undefined || declared === undefined) continue;
    const clientPath = await clientHalfOf(resolved.root);
    if (clientPath !== undefined) found.set(name, { id: name, clientPath });
  }
  return [...found.values()];
}


export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as RouteHost | undefined;

  // **宿主进程的异常要留下痕迹**：dev 形态下 vite 跑在同一个进程里（它的原生绑定或某个未捕获异常崩过一次，
  // 外部只看到连接被拒，无从溯源）。落一份日志到 `$DSH_HOME/logs/dev-host.log`，退出时在 stderr 指路。
  const logFile = join(process.env["DSH_HOME"] ?? join(process.cwd(), ".dsh-store"), "logs", "dev-host.log");
  const appendLog = async (text: string): Promise<void> => {
    try {
      await mkdir(dirname(logFile), { recursive: true });
      await appendFile(logFile, `${new Date().toISOString()} ${text}\n`, "utf8");
    } catch {
      // 记不下来就算了：这里已在异常路径上，不该再抛。
    }
  };
  ctx.effect(() => {
    const onException = (error: Error): void => {
      void appendLog(`[uncaughtException] ${error.stack ?? error.message}`);
    };
    const onRejection = (reason: unknown): void => {
      void appendLog(`[unhandledRejection] ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
    };
    const onExit = (code: number): void => {
      process.stderr.write(`[dsh] dev 宿主退出：code=${String(code)}，异常日志见 ${logFile}\n`);
    };
    process.on("uncaughtException", onException);
    process.on("unhandledRejection", onRejection);
    process.on("exit", onExit);
    return () => {
      process.off("uncaughtException", onException);
      process.off("unhandledRejection", onRejection);
      process.off("exit", onExit);
    };
  }, "dev-client-bundles: 宿主异常日志");
  // 行清单：自己扫（上游 `client-modules` 在 dev patch 里禁用了）。懒建一次——`apply` 不是 async。
  let rowsCache: ClientRow[] | undefined;
  // `ctx.loader` 是 cordis 的服务（属性访问，别用 `ctx.get`——那给的是追踪代理）；上游 `hmr` 也是这么用的。
  const loader = ctx.loader;
  const rows = async (): Promise<ClientRow[]> => {
    if (rowsCache !== undefined) return rowsCache;
    rowsCache = loader === undefined ? [] : await clientRowsOf(loader);
    return rowsCache;
  };
  if (webServer === undefined)
    throw new Error("dev-client-bundles: webServer is a required service");

  // 包名 → 包根：交给 node 的解析（`createRequire(from).resolve`），不自己扫目录。
  // 基准是**发起引用的那个文件**——node 的规则就是这样，pnpm 的 node_modules 也按依赖关系摆好了。
  // 没有 importer 的场合（我们自己生成的入口），退到模块表里任一 client 行当基准（它们都在有依赖的包里）。
  let fallbackBase: string | undefined;
  // 只按**包名**解析（不带子路径）：`resolve('pkg/subpath')` 要求清单有对应的 `exports` 键，而很多包的
  // 子路径是要另外解的（`oniguruma-parser/parser` 这种）。包根拿到之后，子路径再按 `exports` 落文件。
  const rootOf = async (name: string, from?: string): Promise<string | undefined> => {
    const bases = from === undefined ? [] : [from];
    fallbackBase ??= undefined;
    if (fallbackBase !== undefined) bases.push(fallbackBase);
    for (const base of bases) {
      const found = await packageRootOf(base, name);
      if (found !== undefined) return found.root;
    }
    // 兜底：pnpm 的虚拟 store。按出口请求时**没有 importer**（URL 里只有包名），"从谁出发解析"这个信息
    // 已经丢了——嵌套依赖（`oniguruma-parser` 之于 `oniguruma-to-es`）从模块表首行那类基准解析不到，
    // 但 store 里装过就一定能找到。
    return undefined;
  };


  /** 兜底：vite 不认的路径直接 404（dev 形态下页面与资源全归它）。 */
  const fallback = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("dev-client-bundles: 没有这条路由\n");
  };

  // vite dev server（懒建）：客户端资源全权交给它——依赖预打包、CJS→ESM、具名导出、外置 require、共享
  // chunk、HMR 都是它现成的能力；我们只提供"哪些包是行、源码入口在哪"与页面骨架。
  let viteHandoff: Awaited<ReturnType<typeof startViteDev>> | undefined;
  let viteStarting: Promise<void> | undefined;
  const ensureVite = async (): Promise<void> => {
    if (viteHandoff !== undefined) return;
    viteStarting ??= (async () => {
      const repoRoot = process.cwd();
      viteHandoff = await startViteDev(ctx, {
        repoRoot,
        base: PLUGIN_ROUTE,
        // 行清单：包名 → client 半的源文件（各 entry 用**自己的 baseUrl** 解析，见 `clientRowsOf`）。
        rows: { rows: async () => new Map((await rows()).map((row) => [row.id, row.clientPath])) },
        // `/plugins/<pkg>/<version>/<export>` → 源码文件（对外形态 → vite 认的路径）。
        resolvePluginUrl: (url: string) => resolvePluginUrl(url),
        httpServer: (webServer as { server?: Parameters<typeof startViteDev>[1]["httpServer"] }).server,
      });;
    })();
    await viteStarting;
  };

  /**
   * 对外 URL → **源文件**。`exports` 优先，**没有该键**时退回物理路径（上游多数包没有 `./client` 出口，
   * 它们的 client 半就是 `src/client/index.ts`）——中间件的改写与插件的 `resolveId` 共用这一份。
   */
  const resolvePluginUrl = async (url: string): Promise<string | undefined> => {
    const address = parsePluginAddress(url);
    if (address === undefined) return undefined;
    const root = await rootOf(address.name);
    if (root === undefined) return undefined;
    const manifest = await manifestOf(root);
    const subpath = address.exportName === "." ? undefined : address.exportName.slice(2);
    if (subpath !== undefined) {
      const byExports = await exportTargetOf(root, subpath);
      if (byExports !== undefined) return byExports;
      // 物理回退：上游多数包没有 `./client` 出口，它们的 client 半就是 `src/client/index.ts`。
      const pkg = { name: address.name, version: manifest?.version ?? "", root };
      return (
        resolveInPackage(pkg, join("src", subpath, "index.ts")) ??
        resolveInPackage(pkg, join(subpath, "index.ts")) ??
        resolveInPackage(pkg, subpath)
      );
    }
    return await exportTargetOf(root, undefined);
  };

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") return fallback(req, res);
    // `/plugins/*` 下的请求交给 vite。**不做任何 URL 改写**：包名、路径与 client 半的入口都由 vite 自己
    // resolve（它认 node 规则、workspace 软链与 pnpm 布局），我们只提供行清单与页面。
    try {
      await ensureVite();
    } catch (error) {
      ctx.logger.error(error);
    }
    if (viteHandoff?.serve(req, res) === true) return;
    // 其余交回上游的兜底。
    return fallback(req, res);
  };

  const serveAny = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await ensureVite();
    } catch (error) {
      ctx.logger.error(error);
    }
    // 先交给 vite（页面、入口、依赖预打包产物、HMR 通道都是它的）；它不认的再回上游兜底。
    if (viteHandoff !== undefined && viteHandoff.serve(req, res)) return;
    return fallback(req, res);
  };
  // 用与上游同一个 API 占**兜底位**（`registerFallback`）：页面、入口、依赖预打包产物与 HMR 通道都是
  // vite 的；上游 `frontend-static` 那一行（挂在 `web-runtime` 上）在 dev patch 里已停用。
  ctx.effect(() => webServer.registerFallback(serveAny), "dev-client-bundles: vite 兜底");
  // vite 的 HMR WebSocket：上游对**未注册**的升级请求会直接 destroy socket（vite 就握不上手），所以在这
  // 里给它一条同名路由——handler 什么都不做，只让 socket 活着，vite 自己挂在 `upgrade` 上的处理器完成握手。
  ctx.effect(
    () =>
      webServer.registerUpgrade({
        path: HMR_PATH,
        handler: () => {
          /* vite 的 HMR 通道自己处理这次升级 */
        },
      }),
    "dev-client-bundles: vite hmr upgrade",
  );

  ctx.effect(
    // `prefix /plugins`：combo（`/plugins/??a,b`）与按文件寻址（`/plugins/<pkg>/<version>/<file>`）都从
    // 这一个入口进来，在 handler 里按 `req.url` 分发。
    () => webServer.register({ kind: "prefix", path: PLUGIN_ROUTE, handler: serve }),
    "dev-client-bundles: /plugins route",
  );
}
