import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { clientAssetPlugin, clientBundleSpec, cssInlinePlugins } from "@local/devkit";
import type { Context } from "@deepseek-ai/cordis";
import { rolldown, type Plugin, type PluginContext } from "rolldown";
import { esmExternalRequirePlugin } from "rolldown/plugins";
import { COMBO_PATH } from "./combo.ts";
import { startViteDev } from "./serve-vite.ts";
import {
  directImports,
  resolveInPackage,
  encodePackageName,
  isCjsOnlySource,
  packageNameOf,
  exportSegmentOf,
  exportTargetOf,
  manifestOf,
  packageRootOf,
  parsePluginAddress,
  PLUGIN_ROUTE,
} from "./modules.ts";

export const name = "dev-client-bundles";

export const inject = ["loader", "webServer"];


// 打包器（`@local/devkit` 的现场打包面，连带 rolldown 与它的原生绑定）按需加载：打包产物里的行
// 已经切成 dist，这一支一次都不会走——常驻它等于给每个宿主进程白加一份打包器的内存。
interface RouteHost {
  /** 把注入表（boot 数据、引导器、script 行）渲染进一份 index.html 骨架。 */
  renderIndex(html: string): string;
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
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

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
 */
async function clientRowsOf(loader: { entries(): Generator<LoaderEntry> }): Promise<ClientRow[]> {
  const found: ClientRow[] = [];
  // `entries()` 是**生成器**（cordis 的 Loader 就是这么给的），要展开。
  for (const entry of [...loader.entries()]) {
    if (entry.disabled === true || entry.fiber === undefined) continue;
    const name = entry.options?.name;
    if (typeof name !== "string" || name === "") continue;
    // 虚拟入口（`cordis:include`、`<插件>:<组>`）不是包名。
    if (name.includes(":")) continue;
    const baseUrl = entry.parent?.tree?.ctx?.baseUrl;
    if (baseUrl === undefined) continue;
    const resolved = await packageRootOf(baseUrl, name);
    if (resolved === undefined) continue;
    const clientPath = await clientHalfOf(resolved.root);
    if (clientPath !== undefined) found.push({ id: name, clientPath });
  }
  return found;
}

/** 包根 → client 半的源文件：清单的 `exports["./client"]` 优先，其次约定路径 `src/client/index.ts`。 */
async function clientHalfOf(root: string): Promise<string | undefined> {
  const byExports = await exportTargetOf(root, "client");
  if (byExports !== undefined) return byExports;
  const conventional = join(root, "src", "client", "index.ts");
  return (await isDirectory(join(root, "src", "client"))) ? conventional : undefined;
}

export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as RouteHost | undefined;
  // 行清单：自己扫（上游 `client-modules` 在 dev patch 里禁用了）。懒建一次——`apply` 不是 async。
  let rowsCache: ClientRow[] | undefined;
  // `ctx.loader` 是 cordis 的服务（属性访问，别用 `ctx.get`——那给的是追踪代理）；上游 `hmr` 也是这么用的。
  const loader = ctx.loader;
  const rows = async (): Promise<ClientRow[]> => {
    if (rowsCache !== undefined) return rowsCache;
    rowsCache = loader === undefined ? [] : await clientRowsOf(loader);
    process.stderr.write(`[rows] ${String(rowsCache.length)} 行\n`);
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
    // 统一资源路径：`/plugins/<pkg>/<version>/<export>`——仓库包与三方包同格式。
    const address = parsePluginAddress(req.url ?? "");
    if (address !== undefined) {
      try {
        // URL → 一次构建产出的 chunk（`<pkg>@<ver>/<export>.js`，与 URL 同形）。
        const fileName = await bundleExportFiles(address.name, address.exportName);
        const code = fileName === undefined ? undefined : await readFile(fileName, "utf8");
        if (code === undefined) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end(`dev-client-bundles: 未知包 ${address.name}\n`);
          return;
        }
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : code);
      } catch (error) {
        process.stderr.write(`[build] 失败 ${address.name}#${address.exportName}: ${String(error)}\n`);
        ctx.logger.error(error);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(`${error instanceof Error ? error.message : String(error)}\n`);
      }
      return;
    }
    // 3) 其余交回上游的兜底（`frontend-static` 之类）。
    return fallback(req, res);
  };

  // 页面 HTML：dev 形态的页面来自哪儿？上游 `frontend-static` 服务的是**构建产物**里的 index.html
  // （`distIndex`），源码面没有它，于是 `/` 一直是兜底 404。这里接管：给一份最小骨架，其余交给上游的
  // `renderIndex`——注入表（boot 数据 `window.__DSH_BOOT__`、内联引导器、bootstrap/application 的
  // script 行）由订阅者（client-modules 等）自己往表里推，我们不需要拼。上游用的是 `registerFallback`，
  // 我们的 exact 路由优先命中，所以不必禁用那一行。
  const indexHtml = [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>DSH</title>",
    '    <base href="./" />',
    "  </head>",
    // 应用的挂载点：内核的 boot 页在 body 里自建自己的容器，应用挂这里。
    '  <body>',
    '    <main id="app"></main>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");
  // 缓存键是 (包, 出口)：同一个包的不同出口是不同产物；dev 内存即可（内容 hash 作 rev 时再谈落盘）。
  // 预处理产物**落盘**（不是只在内存里）：出问题能直接打开看——哪份产物里 inline 了什么、跨包引用指向
  // 谁，一眼可查。内存缓存只是省掉重复的打包开销，落盘那份才是排查依据。
  const depsDir = join(process.env["DSH_HOME"] ?? join(process.cwd(), ".dsh-store"), "deps");
  // 模块表的行 id 集合（`dsh.client` 声明的权威来源）：入口与跨包引用都按它判断该用哪个出口。
  // 行 id 集合：现在按行清单取（上游 client-modules 已退场）。
  /**
   * 一个**出口**一份产物（各包彼此隔离，可并行）。
   *
   * 入口按 `exports` 取该出口的目标；跨包引用 external 成对方的同格式 URL（改一个包不必重打别的）。
   */
  const packageCache = new Map<string, string>();
  /**
   * 构建**串行化**。
   *
   * 页面首次加载会并行请求几十个出口，而 rolldown 的多实例并发构建撑不住（同发时 500、单发 200）。
   * 用一个 Promise 链把构建排队：每个出口仍然各自独立产物（隔离、可缓存），只是不并发跑原生绑定。
   * 键级去重由 `inFlight` 负责——同一个出口的并发请求共用一个构建。
   */
  let buildQueue: Promise<unknown> = Promise.resolve();
  const inFlight = new Map<string, Promise<string | undefined>>();
  const bundleExportFiles = (name: string, exportName: string): Promise<string | undefined> => {
    const key = `${name}#${exportName}`;
    const cached = packageCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const running = inFlight.get(key);
    if (running !== undefined) return running;
    const task = buildQueue.then(() => buildOne(name, exportName, key));
    buildQueue = task.catch(() => undefined);
    inFlight.set(key, task);
    task.finally(() => inFlight.delete(key));
    return task;
  };

  const buildOne = async (name: string, exportName: string, key: string): Promise<string | undefined> => {
    const root = await rootOf(name);
    if (root === undefined) {
      ctx.logger.error("dev-client-bundles: 解析不到包 %s", name);
      return undefined;
    }
    const pkgManifest = await manifestOf(root);
    const subpath = exportName === "." ? undefined : exportName.slice(2);
    const spec = await clientBundleSpec({ cwd: process.cwd() });
    const entry =
      (await exportTargetOf(root, subpath)) ??
      (subpath === undefined
        ? undefined
        : resolveInPackage({ name, version: pkgManifest?.version ?? "", root }, subpath));
    if (entry === undefined) return undefined;
    // **分层**（这是这套设计的关键，别搅在一起）：
    // · 上半截 `esmExternalRequirePlugin`：认**包名**，把 CJS 的 `require("<包名>")` 转成 facade
    //   （`import * as m from "<包名>"`）。它 `pre` 抢在前面是**对的**——`require` 必须在说明符还叫
    //   `react` 的时候被处理掉，之后 URL 才不会成为 `require` 的参数（URL 级 require 没人能转，
    //   浏览器直接报 "in an environment that doesn't expose the require function"）。
    // · 下半截我们的 `rewritePlugin`：只把过了那层的说明符（含 facade 里的 import）落成
    //   `/plugins/<pkg>/<version>/<export>` 统一 URL。
    // **`react` / `react-dom` 这类必须 external**（不能 inline）：inline 会在每份产物里各留一份实例，
    // hook 分发就冲突（"React 多份自然启动不了"）。
    // **facade 模块**：做法照 vite 的 dep 预打包（`vite:dep-pre-bundle` 那段）——
    //   · 跨包引用 → 返回一个**非 external** 的 facade 虚拟模块（inline 进本产物）；
    //   · facade 内容 `export { default } from "<URL>"; export * from "<URL>";` —— 具名导出由此天然成立
    //     （cjs 的 `require("react")` 也在这里被 rolldown 换成对 facade 的引用），**不用**手搓具名补全；
    //   · facade 内部对 URL 的引用 → `external: "absolute"`，浏览器原生按 URL 取。
    const FACADE_PREFIX = "\0dsh-facade:";
    const rewritePlugin: Plugin = {
      name: "dsh-client-external",
      async resolveId(this: PluginContext, source: string, importer: string | undefined) {
        // facade 里那条指向 URL 的 import：external 且是绝对路径。
        if (source.startsWith(`${FACADE_PREFIX}url:`)) {
          return { id: source.slice(FACADE_PREFIX.length + "url:".length), external: "absolute" };
        }
        if (importer === undefined || source.startsWith(".") || source.startsWith("/")) return null;
        const specifier = packageNameOf(source);
        if (specifier === "") return null;
        const targetRoot = await rootOf(specifier, entry);
        if (targetRoot === undefined) return null;
        const targetManifest = await manifestOf(targetRoot);
        if (targetManifest === undefined) return null;
        const subpath = source === specifier ? undefined : source.slice(specifier.length + 1);
        const segment = subpath === undefined ? exportSegmentOf(".") : exportSegmentOf(`./${subpath}`);
        const url = `${PLUGIN_ROUTE}/${encodePackageName(targetManifest.name)}/${targetManifest.version}/${segment}`;
        // **CJS-only 的包走 facade**（它的 `require` 要在同一趟里被换成对 facade 的引用，并且 facade 的
        // `export { default } from X; export * from X;` 把 CJS 的具名导出补齐）；
        // **ESM 的包直接 external 成 URL**（它本来就有具名导出，套 facade 反而会因为缺 default 报错）。
        const targetEntry = await exportTargetOf(targetRoot, subpath);
        const isCjs = targetEntry !== undefined && isCjsOnlySource(await readFile(targetEntry, "utf8"));
        return isCjs ? { id: `${FACADE_PREFIX}${url}` } : { id: url, external: true };
      },
      load(id: string) {
        if (!id.startsWith(FACADE_PREFIX) || id.startsWith(`${FACADE_PREFIX}url:`)) return null;
        const url = id.slice(FACADE_PREFIX.length);
        const modulePath = `${FACADE_PREFIX}url:${url}`;
        return `export { default } from ${JSON.stringify(modulePath)};\nexport * from ${JSON.stringify(modulePath)};\n`;
      },
    };
    // **预扫**：本入口（及其直接依赖）里哪些包是 **CJS-only**。
    //
    // 两截插件只能有一个赢家，所以把 external 的归属分清楚：
    // · CJS-only 的包（`react` 这类，同步 `require`，必须转 import）→ 交给官方插件（它认包名）；
    // · 其余（我们的 ESM 源码、纯 ESM 的依赖）→ 留给我们的 rewrite（它落成统一路径 URL）。
    const cjsOnly: string[] = [];
    for (const dep of await directImports(entry)) {
      const depRoot = await rootOf(dep, entry);
      if (depRoot === undefined) continue;
      const depManifest = await manifestOf(depRoot);
      const depEntry = await exportTargetOf(depRoot, undefined);
      if (depManifest === undefined || depEntry === undefined) continue;
      const raw = await readFile(depEntry, "utf8");
      if (isCjsOnlySource(raw)) cjsOnly.push(dep);
    }
    process.stderr.write(`[build] ${key} entry=${entry}\n`);
    const build = await rolldown({
      input: entry,
      cwd: root,
      platform: "browser",
      resolve: { conditionNames: spec.conditionNames },
      transform: { define: spec.define },
      treeshake: false,
      plugins: [
        rewritePlugin,
        ...cssInlinePlugins({ name, assets: "threshold" }),
        clientAssetPlugin(),
      ],
    });
    try {
      const { output } = await build.generate({ format: "esm", exports: "auto", codeSplitting: false });
      const chunk = output.find((item) => item.type === "chunk");
      if (chunk === undefined || chunk.type !== "chunk") return undefined;
      const fileName = join(
        depsDir,
        `${encodePackageName(name)}@${pkgManifest?.version ?? "unknown"}`,
        `${exportSegmentOf(exportName)}.js`,
      );
      await mkdir(dirname(fileName), { recursive: true });
      await writeFile(fileName, chunk.code);
      packageCache.set(key, fileName);
      process.stderr.write(`[build] ok ${key} → ${fileName}\n`);
      return fileName;
    } finally {
      await build.close();
    }
  };

  async function clientEntryUrl(id: string): Promise<string | undefined> {
    const root = await rootOf(id);
    if (root === undefined) return undefined;
    const manifest = await manifestOf(root);
    if (manifest === undefined) return undefined;
    const target = await exportTargetOf(root, "client");
    if (target === undefined) return undefined;
    // **先走 vite 的原生形态**：入口里用**包名**（bare），由 vite 的解析 + 我们插件的 resolveId 落到源码。
    return manifest.name;
  }


  const serveAny = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    process.stderr.write(`[serveAny] ${req.method ?? "?"} ${req.url ?? ""}\n`);
    try {
      await ensureVite();
      process.stderr.write(`[serveAny] vite=${String(viteHandoff !== undefined)}\n`);
    } catch (error) {
      process.stderr.write(`[serveAny] vite 启动失败: ${String(error)}\n`);
      ctx.logger.error(error);
    }
    // 先交给 vite（页面、入口、依赖预打包产物、HMR 通道都是它的）；它不认的再回上游兜底。
    if (viteHandoff !== undefined && viteHandoff.serve(req, res)) return;
    return fallback(req, res);
  };
  // 用与上游同一个 API 占**兜底位**（`registerFallback`）：页面、入口、依赖预打包产物与 HMR 通道都是
  // vite 的；上游 `frontend-static` 已由 `dev-web-handover.patch` 让出这个位置。
  ctx.effect(() => webServer.registerFallback(serveAny), "dev-client-bundles: vite 兜底");

  ctx.effect(
    // `prefix /plugins`：combo（`/plugins/??a,b`）与按文件寻址（`/plugins/<pkg>/<version>/<file>`）都从
    // 这一个入口进来，在 handler 里按 `req.url` 分发。
    () => webServer.register({ kind: "prefix", path: PLUGIN_ROUTE, handler: serve }),
    "dev-client-bundles: /plugins route",
  );
}
