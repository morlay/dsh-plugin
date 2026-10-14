import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative, sep } from "node:path";
import type { Duplex } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import { ASSET_MIME, NODE_BUILTIN } from "./assets.ts";
import { devExcluded, isAggregated } from "./config.ts";
import {
  appBootDir,
  dataDir,
  cacheDir,
  packageManifestPath,
  profileDir,
  profileManifestPath,
  resolutionManifestPath,
  resolutionRoot,
  storeDir,
} from "./dirs.ts";
import {
  bundlePackage,
  CLIENT_MODULES_PREFIX,
  clientModulesAlias,
  dependencyEntry,
  urlOf,
} from "./bundle.ts";
import { HMR_PATH, startViteDev } from "./serve-vite.ts";
import {
  clientHalfOf,
  decodePackageName,
  exportTargetOf,
  fileInPackage,
  manifestOf,
  owningPackageOf,
  packageNameOf,
  packageRootOf,
  parsePluginAddress,
  PLUGIN_ROUTE,
  resolveInPackage,
  workspacePackagesMatching,
} from "./resolve.ts";

export const name = "client-modules";

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
  /** 包版本：联邦地址（`@client-modules/<pkg>@<version>/<file>`）的组成部分。 */
  version: string;
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
    if (clientPath === undefined) continue;
    // 本地文件一律写成 `@/{filepath}`（对外只有两种形态：`@/…` 本地文件、`@client-modules/…` 联邦产物）。
    // 入口是**源码文件路径**：vite 按它解析、按需转换（改着的包逐文件走，HMR 照旧）；而
    // "这次不改的包"（`dsh.dev.exclude`）会进 `optimizeDeps.include`——vite 把该文件收编成依赖，
    // 引用被重写成它的 deps 产物（一次构建、共享 chunk、落盘缓存、按内容 hash 失效）。
    found.set(name, {
      id: name,
      clientPath: `@/${relative(await resolutionRoot(), clientPath).split(sep).join("/")}`,
      version: manifest.version,
    });
  }
  return [...found.values()];
}





/** 打包器指纹的输入集：**只与包有关、与出口无关**（缓存按包聚合，rev 跟着出口变就等于永不命中）。 */
function watchOf(root: string | undefined, entry: string): string[] {
  if (root === undefined) return [entry];
  return root.includes("node_modules") ? [join(root, "package.json")] : [join(root, "src")];
}

export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as RouteHost | undefined;
  // 本包的位置（`src/` 或打包后的 `dist/`）：`app-boot` 与仓库根都从它推。
  //
  // **不用 `process.cwd()`**：桌面形态的宿主进程 cwd 是 profile 目录（`apps/<profile>`），从那里推出来的
  // 仓库根、app-boot、缓存目录全是错的（web 形态下 cwd 恰好是仓库根，所以这条一直没暴露）。
  const appRoot = appBootDir();
  // 日志落在数据根下（`$DSH_HOME/logs/…`）：`apply` 是同步的，所以这里先起一个 promise，用时再等。
  const logFileOf = dataDir().then((dir) => join(dir, "logs", "dev-host.log"));
  // 与上面同一个事实的同步镜像：`onExit` 回调不能 await，只能读已经落定的那一份。
  let resolvedLogFile: string | undefined;
  void logFileOf.then((file) => { resolvedLogFile = file; });

  // **宿主进程的异常要留下痕迹**：dev 形态下 vite 跑在同一个进程里（它的原生绑定或某个未捕获异常崩过一次，
  // 外部只看到连接被拒，无从溯源）。落一份日志到数据根的 `logs/dev-host.log`，退出时在 stderr 指路。
  const appendLog = async (text: string): Promise<void> => {
    try {
      const logFile = await logFileOf;
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
      // 退出回调是同步的（不能 await）：日志路径在退出前早已解析好，直接取缓存值。
      const shown = resolvedLogFile ?? "(尚未就绪)";
      process.stderr.write(`[dsh] dev 宿主退出：code=${String(code)}，异常日志见 ${shown}\n`);
    };
    process.on("uncaughtException", onException);
    process.on("unhandledRejection", onRejection);
    process.on("exit", onExit);
    return () => {
      process.off("uncaughtException", onException);
      process.off("unhandledRejection", onRejection);
      process.off("exit", onExit);
    };
  }, "client-modules: 宿主异常日志");
  // 行清单：自己扫（上游 `client-modules` 在 dev patch 里禁用了）。懒建一次——`apply` 不是 async。
  let rowsCache: ClientRow[] | undefined;
  // `ctx.loader` 是 cordis 的服务（属性访问，别用 `ctx.get`——那给的是追踪代理）；上游 `hmr` 也是这么用的。
  const loader = ctx.loader;
  // 非开发模块（`dsh.dev.exclude` 点名）：入口交给 vite 的 `optimizeDeps`——一次构建、共享 chunk、
  // 落盘缓存、按内容 hash 失效，全是 vite 现成的机制。它们的入口用**包名**（optimizer 只认裸说明符），
  // 由 alias 指到各自的 client 半源码。
  let excludedCache: RegExp[] | undefined;
  const excludedOf = async (): Promise<RegExp[]> => (excludedCache ??= await devExcluded(await profileDir()));
  const sourceRowsOf = async (): Promise<ClientRow[]> => {
    rowsCache ??= loader === undefined ? [] : await clientRowsOf(loader);
    return rowsCache;
  };
  const allRowsOf = async (): Promise<ClientRow[]> => {
    const patterns = await excludedOf();
    return (await sourceRowsOf()).map((row) =>
      // **非开发模块**（`dsh.dev.exclude` 点名）的行给**包名**而不是路径：走哪条链（联邦产物 / 源码）
      // 由解析规则决定，地址也由同一份出口表（`urlOf`）算——这里写死 URL 就等于把"地址长什么样"抄成两份。
      isAggregated(row.id, patterns) ? { ...row, clientPath: row.id } : row,
    );
  };
  const rows = async (): Promise<ClientRow[]> => await allRowsOf();
  if (webServer === undefined)
    throw new Error("client-modules: webServer is a required service");

  // 包名 → 包根：交给 node 的解析（`createRequire(from).resolve`），不自己扫目录。
  // 基准是**发起引用的那个文件**——node 的规则就是这样，pnpm 的 node_modules 也按依赖关系摆好了。
  // 没有 importer 的场合（我们自己生成的入口），退到模块表里任一 client 行当基准（它们都在有依赖的包里）。
  let fallbackBase: string | undefined;
  // 只按**包名**解析（不带子路径）：`resolve('pkg/subpath')` 要求清单有对应的 `exports` 键，而很多包的
  // 子路径是要另外解的（`oniguruma-parser/parser` 这种）。包根拿到之后，子路径再按 `exports` 落文件。
  const rootOf = async (name: string, from?: string): Promise<string | undefined> => {
    const bases = from === undefined ? [] : [from];
    // 解析基准：profile 的 `package.json`——pnpm 从这里能解析到工作区里的包
    // （我们自己生成的入口没有 importer，得有个能站住的基准）。
    fallbackBase ??= await profileManifestPath();
    if (fallbackBase !== undefined) bases.push(fallbackBase);
    // 本包自己的清单也是一个基准：这条链的运行期依赖声明在它里面——典型是 rolldown 注入装饰器 helper 用的
    // `@oxc-project/runtime`，pnpm 的严格布局下从 profile 出发解析不到，只有从声明它的包出发才找得到。
    bases.push(packageManifestPath());
    for (const base of bases) {
      const found = await packageRootOf(base, name);
      if (found !== undefined) return found.root;
    }
    // 兜底：pnpm 的虚拟 store。按出口请求时**没有 importer**（URL 里只有包名），"从谁出发解析"这个信息
    // 已经丢了——嵌套依赖（`oniguruma-parser` 之于 `oniguruma-to-es`）从模块表首行那类基准解析不到，
    // 但 store 里装过就一定能找到。
    return undefined;
  };


  /** 兜底：vite 不认的路径直接 404（dev 形态下页面与资源全归它）。 */  const fallback = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("client-modules: 没有这条路由\n");
  };

  // vite dev server（懒建）：客户端资源全权交给它——依赖预打包、CJS→ESM、具名导出、外置 require、共享
  // chunk、HMR 都是它现成的能力；我们只提供"哪些包是行、源码入口在哪"与页面骨架。
  let viteHandoff: Awaited<ReturnType<typeof startViteDev>> | undefined;
  let viteStarting: Promise<void> | undefined;
  /** 地址只印一次（vite 就绪那一刻，跟它自己的 ready 提示一个意思）。 */
  let announced = false;
  const ensureVite = async (): Promise<void> => {
    if (viteHandoff !== undefined) return;
    viteStarting ??= (async () => {
      const repoRoot = await resolutionRoot();
      const started = await startViteDev(ctx, {
        repoRoot,
        base: PLUGIN_ROUTE,
        // 行清单：包名 → client 半的源文件（各 entry 用**自己的 baseUrl** 解析，见 `clientRowsOf`）。
        rows: { rows: async () => new Map((await rows()).map((row) => [row.id, row.clientPath])) },
        // `/plugins/<pkg>/<version>/<export>` → 源码文件（对外形态 → vite 认的路径）。
        resolvePluginUrl: (url: string) => resolvePluginUrl(url),
        depsUrl: (specifier: string) => depsUrlOfSpecifier(specifier),
        // 同源的 http server：web 形态是宿主自己的端口；桌面形态是宿主**进程内**的回环端点
        // （`desktopUpgradeServer`）——HMR 的 WebSocket 就挂它上面，页面侧由垫片重写到它。
        httpServer: (
          webServer as {
            server?: Parameters<typeof startViteDev>[1]["httpServer"];
            desktopUpgradeServer?: Parameters<typeof startViteDev>[1]["httpServer"];
          }
        ).server ??
          (
            webServer as {
              desktopUpgradeServer?: Parameters<typeof startViteDev>[1]["httpServer"];
            }
          ).desktopUpgradeServer,
      });
      viteHandoff = started;
    })();
    await viteStarting;
    if (!announced) {
      announced = true;
      const port = process.env["PORT"] ?? "3080";
      process.stdout.write(`\n  ➜  Local:   http://127.0.0.1:${port}/\n\n`);
    }
  };

  /** 解析根那份 tsconfig 的路径（不存在时返回 undefined，交给 rolldown 默认）。 */
  const tsconfigOf = async (): Promise<string | undefined> => {
    const candidate = join(await resolutionRoot(), "tsconfig.json");
    return (await readFile(candidate, "utf8").then(() => true, () => false)) ? candidate : undefined;
  };

  /** 一个包声明的运行期依赖：`dependencies` + `peerDependencies` 的键（外置名单的唯一来源）。 */
  const declaredDependenciesOf = async (root: string | undefined): Promise<string[]> => {
    if (root === undefined) return [];
    const manifest = (await manifestOf(root).catch(() => undefined)) as
      | { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
      | undefined;
    return [
      ...new Set([
        ...Object.keys(manifest?.dependencies ?? {}),
        ...Object.keys(manifest?.peerDependencies ?? {}),
      ]),
    ];
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

  // 聚合与三方的缓存都在 `node_modules/` 下（与 vite 的 `.vite` 并列，跨进程共用）。
  // 一个缓存目录：三方的与我们的**没有本质区别**（同一条链、同一种地址）。
  // 缓存与 alias 都要仓库根，但 `apply` 是同步的：惰性算一次。
  let cacheRootCache: string | undefined;
  const cacheRootOf = async (): Promise<string> => (cacheRootCache ??= await cacheDir());
  const federationAliasOf = async (): Promise<ReturnType<typeof clientModulesAlias>> => clientModulesAlias({
    repoRoot: await resolutionRoot(),
    // 联邦构建走 rolldown：替身必须是 CJS 形态，否则未知具名导入在构建期就是 `MISSING_EXPORT`。
    nodeStub: join(appRoot, "node-stub.cjs"),
  });
  // 外置说明符要写成"联邦地址"，而 `paths` 回调不能 await：先把要用的两张表算出来。
  // 表一：包名 → 它外置时该指的**出口**——`client` 就是清单里的一个普通 export（有 `./client` 用它，
  // 否则根出口）。这不是"身份判断"，所以 `immer` 这类三方不会因为它被特殊对待。
  // 两张表**懒建一次**：它们要扫工作区（几百个清单）与 pnpm store，而联邦路由是**每个请求**都要它们
  // ——每次重算等于把首屏时间乘以产物数（几百次全仓扫描）。dev 里包的版本与出口不会中途变。
  let exportsCache: Promise<ReadonlyMap<string, string>> | undefined;
  const exportNamesOf = async (): Promise<ReadonlyMap<string, string>> =>
    await (exportsCache ??= (async () => {
      const names = new Map<string, string>();
      const packages = await workspacePackagesMatching(await profileManifestPath(), [
        /.*/u,
      ]);
      for (const pkg of packages) {
        const manifest = await manifestOf(pkg.root).catch(() => undefined);
        const exports = (manifest as { exports?: Record<string, unknown> } | undefined)?.exports ?? {};
        names.set(pkg.name, "./client" in exports ? "client" : "index");
      }
      return names as ReadonlyMap<string, string>;
    })());
  let versionsCache: Promise<ReadonlyMap<string, string>> | undefined;
  const ownVersionsOf = async (): Promise<ReadonlyMap<string, string>> =>
    await (versionsCache ??= (async () => {
      // 版本表要覆盖**工作区里的所有包**：外置说明符里会出现没进行清单的（cordis、client-store…），
      // 而联邦地址必须带版本。行清单里的包版本从行里取，其余从各自的清单读。
      const versions = new Map<string, string>();
      for (const row of await sourceRowsOf()) versions.set(row.id, row.version);
      const packages = await workspacePackagesMatching(await profileManifestPath(), [/.*/u]);
      for (const pkg of packages) {
        if (versions.has(pkg.name)) continue;
        const manifest = await manifestOf(pkg.root).catch(() => undefined);
        if (manifest !== undefined) versions.set(pkg.name, manifest.version);
      }
      // 三方也要版本（zod、immer、react…）：pnpm 的 store 目录名就是 `<名字>@<版本>`（scope 写成
      // `@scope+name@1.2.3`），读一层目录即可，不必去读几千个清单。**peer 后缀要去掉**：同一包因 peer
      // 不同会有多份目录（`zustand@4.5.7_@types+react@18…`），从最后一个 `@` 切会把 `18.3.1` 当版本。
      const store = await readdir(await storeDir(), { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of store) {
        if (!entry.isDirectory()) continue;
        const matched = /^(?<name>.+?)@(?<version>[^_@]+)(?:_.*)?$/u.exec(entry.name);
        const name = matched?.groups?.["name"];
        const version = matched?.groups?.["version"];
        if (name === undefined || version === undefined) continue;
        const bare = name.replaceAll("+", "/");
        if (!versions.has(bare)) versions.set(bare, version);
      }
      return versions as ReadonlyMap<string, string>;
    })());

  /**
   * dev 侧源码里的**裸说明符** → 联邦地址；`undefined` 表示"交给 vite 走源码"。
   *
   * 判据与产物侧一致：仓库内的**开发模块**（没被 `dsh.dev.exclude` 点名）逐文件走 vite（改它要 HMR）；
   * 其余——三方与"非开发模块"——都由联邦链按包产出（同一条链、同一种地址）。放给 vite 的 `optimizeDeps`
   * 会多出第二条链：浏览器里同时有 `.vite/deps/react.js` 与我们的 `@client-modules/react@…/index.js`，
   * 两个 react 实例，hook 分发立刻报 `Invalid hook call`。
   */
  const depsUrlOfSpecifier = async (specifier: string): Promise<string | undefined> => {
    // `@/…` 是本地文件（alias 管），不是包——`packageNameOf` 会把它切成 `@/vendor` 这种假包名。
    if (specifier.startsWith("@/")) return undefined;
    // `zlib` / `stream` 这类**裸名的 node 内置**不是包：接管成联邦地址只会换来一串 404。留给 alias
    // 的替身（名单同一份）。
    if (NODE_BUILTIN.test(specifier)) return undefined;
    const bare = packageNameOf(specifier) || specifier;
    const root = await rootOf(bare);
    const devModule =
      root !== undefined && !root.includes("node_modules") && !isAggregated(bare, await excludedOf());
    if (devModule) return undefined;
    return urlOf(specifier, { versions: await ownVersionsOf(), exportsOf: await exportNamesOf() });
  };

  /**
   * `@client-modules/<pkg>@<version>/<file>`：**联邦式**的统一寻址。
   *
   * 三方（react）与我们的包在这件事上没有区别——都是"带版本、可独立寻址的一份产物"。落在哪个缓存里
   * 由"包是不是我们这个工作区的"决定：是 → 按包聚合（整包一次 vite build、产物按出口分开）；
   * 不是 → 三方的预打包。两条链用的是同一份配置。
   */
  const serveFederation = async (
    url: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const cacheRoot = await cacheRootOf();
    const federationAlias = await federationAliasOf();
    // `?v=` 是**构建世代**（见 `urlOf`）：它在地址里只是让"同一份产物的 URL 稳定且可辨识"，
    // 路由不据此改变响应（产物一律协商缓存）。
    const rest = (url.slice(`${CLIENT_MODULES_PREFIX}/`.length).split("?")[0] ?? "");
    const slash = rest.indexOf("/");
    process.stderr.write(`[fed] rest=${rest} slash=${String(slash)}\n`);
    if (slash <= 0) return false;
    const pkgVersion = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    // scope 的 `@` 在前、版本分隔的在后：从**最后一个** `@` 切。
    const at = pkgVersion.lastIndexOf("@");
    if (at <= 0) return false;
    const name = decodePackageName(pkgVersion.slice(0, at));
    const urlVersion = pkgVersion.slice(at + 1);
    // 入口：我们的包按 `exports` 找 client 半；三方按 node 的解析找。之后**同一条链**。
    // 一视同仁：包根可能在仓库里（工作区/vendor），也可能在 node_modules（三方）——对取入口这件事
    // 没有区别。出口名来自 URL，入口一律从清单的 `exports` 取。
    const root = await rootOf(name);
    // 版本以**包清单**为准：URL 里那个是外置时按版本表写下的，而多版本共存时表只能猜（`katex@0.16.47`
    // 的 URL 解析到的可能是 0.18.10）——缓存键跟着清单走，键与内容才对得上。
    const version = (root === undefined ? undefined : (await manifestOf(root))?.version) ?? urlVersion;
    const key = `${name.replaceAll("/", "+")}@${version}`;
    // **资产**（大图 / 字体 / worker）：产物里只留 URL，文件本身按清单（`.files.json`）取——清单是
    // "这个包产出里有什么"的唯一真相，也顺手挡住了凭 URL 读任意文件。
    if (file.startsWith("assets/")) {
      const manifest = JSON.parse(await readFile(join(cacheRoot, key, ".files.json"), "utf8").catch(() => "{}")) as {
        files?: Record<string, string>;
      };
      const target = manifest.files?.[file];
      if (target === undefined) return false;
      const bytes = await readFile(join(cacheRoot, target)).catch(() => undefined);
      if (bytes === undefined) return false;
      const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
      res.writeHead(200, {
        "content-type": ASSET_MIME[extension] ?? "application/octet-stream",
        // 资产的文件名里就带内容 hash（`assets/<name>-<hash>.<ext>`）：内容与 URL 一一对应，可以长缓存。
        "cache-control": "public, max-age=31536000, immutable",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
      return true;
    }
    const exportName = file.replace(/\.js$/u, "") || "index";
    const entry =
      root === undefined
        ? (await dependencyEntry(await resolutionManifestPath(), name).catch(() => undefined))
            ?.entry
        : ((await exportTargetOf(root, exportName === "index" ? undefined : exportName)) ??
          // 清单没覆盖这个子路径时按物理路径找（没有 `exports` 的老包：`picomatch/posix` 就是 `posix.js`）。
          (await fileInPackage(root, exportName)));
    process.stderr.write(
      `[fed] ${name}@${version}/${exportName} root=${String(root)} entry=${String(entry)}\n`,
    );
    if (entry === undefined) {
      // 仓库内的包但**这一侧没有实现**（纯 host 包：只有 `./types` 出口、`src/` 下全是宿主代码）：
      // client 图里偶有值引用它们（跨包类型 oxc 判定不了，保守保留），客户端本就拿不到宿主半——
      // 给个空模块，让它照样是"导入了、什么都没导出"。
      if (root !== undefined) {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(req.method === "HEAD" ? undefined : "export {};\n");
        return true;
      }
      // **这里只剩一种情况：说明符既不是内置、也不在闭包里**——即"这台机器上没有的可选依赖"
      // （`ws` 的 `require("bufferutil")`，它本就在 try/catch 里；pnpm 也不装传递的原生可选包）。
      //
      // 区别对待，别混成一锅：
      // - **内置**（`node:*`、`fs/promises`…）在更早的解析里就被替身接管了，**不该**走到这里；真走到了
      //   就是规则有漏，如实 404（上面那条就是为此把伪造空模块删掉的）。
      // - **可选依赖**：产物里的 `require` 已被转成模块图里的 ESM import，一个 404 就让整条图断掉、入口
      //   一行都不执行（页面空白，且只有一句没头没尾的模块错误）。它本就允许缺失，给空模块是对的。
      process.stderr.write(
        `[optional-missing] ${name}@${version}/${exportName}: 闭包里没有（可选依赖？），给空模块\n`,
      );
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : "export {};\n");
      return true;
    }
    const bundled = await bundlePackage({
      cacheRoot,
      repoRoot: await resolutionRoot(),
      alias: federationAlias,
      name,
      version,
      input: { [exportName]: entry },
      // 指纹的输入必须**与出口无关**（缓存是按包聚合的，rev 随出口变就等于永不命中）：仓库内的包看它的
      // `src`（源码改了就重打）；`node_modules` 里的包看它的清单——那边的目录名与布局都不由我们定，
      // 拿目录去算只会算到空（曾经所有三方包的指纹都是同一个空目录的哈希）。
      watch: watchOf(root ?? (await owningPackageOf(entry))?.root, entry),
      versions: await ownVersionsOf(),
      // **就近**：外置名单就是这个包自己声明的运行期依赖（`dependencies` + `peerDependencies`）。
      declaredDependencies: await declaredDependenciesOf(root),
      // 编译设置：解析根那份 tsconfig（有就用；没有交给 rolldown 默认）。
      ...(await tsconfigOf().then((path) => (path === undefined ? {} : { tsconfig: path }))),
      exportsOf: await exportNamesOf(),
    }).catch((error: unknown) => {
      process.stderr.write(`[federation] ${name} 构建失败: ${String(error)}\n`);
      return undefined;
    });
    if (bundled === undefined) return false;
    process.stderr.write(
      `[fed-tail] ${name}: files=${[...bundled.files.keys()].join(",")} exportName=${exportName}\n`,
    );
    const target = bundled.files.get(exportName) ?? bundled.files.get("client") ?? bundled.files.get("index");
    process.stderr.write(`[fed-tail] ${name}: target=${String(target)} 绝对=${String(target === undefined ? undefined : join(cacheRoot, target))}\n`);
    if (target === undefined) {
      process.stderr.write(`[fed] ${name}: 产物里没有 ${exportName}（有 ${[...bundled.files.keys()].join(",")}）\n`);
      return false;
    }
    const code = await readFile(join(cacheRoot, target), "utf8").catch((error: unknown) => {
      process.stderr.write(`[fed] ${name}: 读不到 ${join(cacheRoot, target)}（${String(error)}\n`);
      return undefined;
    });
    // 空产物是**合法的**：纯类型 / 空的 client 半编译出来就是空 JS，不是失败。
    if (code === undefined) return false;
    // 产物缓存策略**按"这份产物还会不会变"分**：
    // - 三方包（`node_modules` 里的）在 dev 期间不会变，地址里又有它的版本 + 构建世代，可以长缓存；
    // - 仓库内的包（`dsh.dev.exclude` 点名的那些）随时可能被改 → 协商缓存（`no-cache` + `ETag`，
    //   重复请求走 304）。这就是 vite 对"预打包依赖"与"源码模块"的分法。
    const cacheControl =
      root !== undefined && !root.includes("node_modules")
        ? "no-cache"
        : "public, max-age=31536000, immutable";
    // **不发 304**：这边的响应最终要由上游包成 Fetch `Response`，而它不接受 304
    // （`Invalid response status code 304`）——请求会以异常告终。产物本来就不大，直接 200 全量。
    const etag = `"${bundled.rev}"`;
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": cacheControl,
      etag,
    });
    res.end(req.method === "HEAD" ? undefined : code);
    return true;
  };

  const serveAny = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // 桌面形态的请求经自定义协议（`dsh-…://app/…`）进来，`req.url` 是**完整 URL** 而不是路径——先归一，
    // 否则下面所有按路径判断的规则（`@` 前缀、页面、联邦地址）都会落空，页面直接 404。
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(req.url ?? "")) {
      const absolute = new URL(req.url ?? "");
      req.url = `${absolute.pathname}${absolute.search}`;
    }
    // **拒的是"仓库路径"，不是"非 `@` 前缀"**：vite 的 root 就是 `app-boot`，页面自己的资源在这个 root
    // 下是**root 相对**的 URL（`/index.ts`、`/base.css`、将来的 `/assets/…`），逐个列举只会漏——今天就
    // 漏了 `/base.css`（vite 解析出来就是它，被白名单挡在门外 → 入口整条没跑起来，页面空）。
    //
    // 真正该拦的是那些"没被解析规则换掉"的漏网请求：裸的 `/packages/…`、`/vendor/…`、`/apps/…`、
    // `/node_modules/…`——它们是仓库里的路径，在打包形态下根本不存在，放过去只会让人在几百条请求里猜。
    const requestPath = (req.url ?? "").split("?")[0] ?? "";
    const path = requestPath;
    const repoPath = /^\/(?:packages|vendor|apps|devpackages|node_modules)(?:\/|$)/u;
    const known = !repoPath.test(path);
    // 浏览器自己的探测（Chrome DevTools 的 `.well-known`）：给个 204，别让它出现在失败列表里。
    if (path.startsWith("/.well-known/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!known) {
      process.stderr.write(`[reject] ${req.url ?? ""} referer=${req.headers.referer ?? "-"}\n`);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("client-modules: 这是仓库里的路径，打包形态下不存在（页面资源在 app-boot 下、包走 exports）\n");
      return;
    }
    process.stderr.write(`[serveAny] ${req.url ?? ""}
`);
    // 页面由**我们自己**服务：读 `app-boot/index.html`，注入 vite 的客户端（HMR），入口脚本仍走 vite
    // （它要转译 `index.ts`、解析 `dsh-client-rows` 虚拟模块）。
    //
    // 为什么不交给 vite 的 indexHtml 中间件：桌面形态的请求经自定义协议（`dsh-…://app/`）进来，那条
    // 中间件不认（返回 404），而两端要的页面是同一份。
    if (requestPath === "/" || requestPath === "/index.html") {
      const html = await readFile(join(appRoot, "index.html"), "utf8").catch(() => undefined);
      if (html === undefined) {
        process.stderr.write(`[serveAny] 页面骨架读不到：${join(appRoot, "index.html")}\n`);
        return fallback(req, res);
      }
      try {
        await ensureVite();
      } catch (error) {
        ctx.logger.error(error);
      }
      // HMR 客户端只在那条通道真的挂着时才注入（无端口形态没有同源的 http server，注了只会报
      // `WebSocket closed without opened.`）。
      const injected =
        viteHandoff?.hmr === true
          ? html.replace("</head>", `  <script type="module" src="/@vite/client"></script>\n  </head>`)
          : html;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : injected);
      return;
    }
    const requestUrl = req.url ?? "";
    if (requestUrl.split("?")[0]?.startsWith(`${CLIENT_MODULES_PREFIX}/`) === true) {
      const handled = await serveFederation(requestUrl, req, res);
      process.stderr.write(`[fed-exit] ${requestUrl} handled=${String(handled)} status=${String(res.statusCode)}\n`);
      if (handled) return;
    }
    try {
      await ensureVite();
    } catch (error) {
      ctx.logger.error(error);
    }
    // 先交给 vite（页面、入口、HMR 通道都是它的）；它不认的再回上游兜底。
    //
    // 结果留一行（与联邦那条 `[fed-exit]` 对称）：入口 `index.ts` 转译失败时，浏览器那边只报一句
    // 没头没尾的模块错误，而这里能直接看到是哪个 URL、什么状态。
    //
    // **`@` 前缀的路径不兜给页面**：那是这条链的模块 URL 空间，没解析出来就是解析规则漏了一段——当场 404
    // 并把 URL 与 referer 打出来，别让它静默变成一份 HTML（那样浏览器只会报"模块语法错误"）。
    if (viteHandoff !== undefined && viteHandoff.serve(req, res)) {
      process.stderr.write(`[vite-out] ${path} status=${String(res.statusCode)}\n`);
      return;
    }
    if (path.startsWith("/@")) {
      process.stderr.write(`[unresolved] ${req.url ?? ""} referer=${req.headers.referer ?? "-"}\n`);
    }
    return fallback(req, res);
  };
  // 用与上游同一个 API 占**兜底位**（`registerFallback`）：页面、入口、依赖预打包产物与 HMR 通道都是
  // vite 的；上游 `frontend-static` 那一行（挂在 `web-runtime` 上）在 dev patch 里已停用。
  ctx.effect(() => webServer.registerFallback(serveAny), "client-modules: vite 兜底");
  // **懒建**（第一条请求时起）：桌面的宿主会在启动过程中把"同源 http server"（进程内回环端点）挂到
  // webServer 上，而这条链要拿它当 HMR 的落脚点——预热跑在这之前就会拿不到它，HMR 从此挂不上去。
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
    "client-modules: vite hmr upgrade",
  );

  ctx.effect(
    // `prefix /plugins`：对外形态（`/plugins/<pkg>/<version>/<export>`）之外的资源都由 vite 的兜底路由
    // 处理，这里只留一条出口给「按包寻址」的请求。
    () => webServer.register({ kind: "prefix", path: PLUGIN_ROUTE, handler: serve }),
    "client-modules: /plugins route",
  );
}
