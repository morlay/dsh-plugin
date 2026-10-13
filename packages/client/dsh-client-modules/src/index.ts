import { appendFile, mkdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative, sep } from "node:path";
import type { Duplex } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import { devExcluded, isAggregated, profileRootOf } from "./config.ts";
import {
  bundlePackage,
  CLIENT_MODULES_CACHE,
  CLIENT_MODULES_PREFIX,
  dependencyEntry,
} from "./bundle.ts";
import { HMR_PATH, startViteDev } from "./serve-vite.ts";
import {
  clientHalfOf,
  decodePackageName,
  encodePackageName,
  exportTargetOf,
  manifestOf,
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
      clientPath: `@/${relative(process.cwd(), clientPath).split(sep).join("/")}`,
      version: manifest.version,
    });
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
  }, "client-modules: 宿主异常日志");
  // 行清单：自己扫（上游 `client-modules` 在 dev patch 里禁用了）。懒建一次——`apply` 不是 async。
  let rowsCache: ClientRow[] | undefined;
  // `ctx.loader` 是 cordis 的服务（属性访问，别用 `ctx.get`——那给的是追踪代理）；上游 `hmr` 也是这么用的。
  const loader = ctx.loader;
  // 非开发模块（`dsh.dev.exclude` 点名）：入口交给 vite 的 `optimizeDeps`——一次构建、共享 chunk、
  // 落盘缓存、按内容 hash 失效，全是 vite 现成的机制。它们的入口用**包名**（optimizer 只认裸说明符），
  // 由 alias 指到各自的 client 半源码。
  let excludedCache: RegExp[] | undefined;
  const excludedOf = async (): Promise<RegExp[]> => (excludedCache ??= await devExcluded());
  const sourceRowsOf = async (): Promise<ClientRow[]> => {
    rowsCache ??= loader === undefined ? [] : await clientRowsOf(loader);
    return rowsCache;
  };
  const allRowsOf = async (): Promise<ClientRow[]> => {
    const patterns = await excludedOf();
    return (await sourceRowsOf()).map((row) =>
      isAggregated(row.id, patterns)
        ? {
            ...row,
            clientPath: `${CLIENT_MODULES_PREFIX}/${encodePackageName(row.id)}@${row.version}/client.js`,
          }
        : row,
    );
  };
  const optimizeInclude = async (): Promise<string[]> => (await allRowsOf()).map((row) => row.clientPath);
  const optimizeAlias = async (): Promise<{ name: string; entry: string }[]> => {
    const patterns = await excludedOf();
    return (await sourceRowsOf())
      .filter((row) => isAggregated(row.id, patterns))
      .map((row) => ({ name: row.id, entry: row.clientPath }));
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
    fallbackBase ??= join(await profileRootOf(), "package.json");
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
      const repoRoot = process.cwd();
      const started = await startViteDev(ctx, {
        repoRoot,
        base: PLUGIN_ROUTE,
        // 行清单：包名 → client 半的源文件（各 entry 用**自己的 baseUrl** 解析，见 `clientRowsOf`）。
        rows: { rows: async () => new Map((await rows()).map((row) => [row.id, row.clientPath])) },
        // `/plugins/<pkg>/<version>/<export>` → 源码文件（对外形态 → vite 认的路径）。
        resolvePluginUrl: (url: string) => resolvePluginUrl(url),
        // 非开发模块的入口（包名）与它们的 alias：交给 vite 的 `optimizeDeps` 预打包。
        optimizeInclude: await optimizeInclude(),
        optimizeAlias: await optimizeAlias(),
        httpServer: (webServer as { server?: Parameters<typeof startViteDev>[1]["httpServer"] }).server,
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
  const cacheRoot = join(process.cwd(), CLIENT_MODULES_CACHE);
  const appRoot = join(process.cwd(), "packages", "client", "dsh-client-modules", "app-boot");
  const federationAlias = [
    { find: /^@\//, replacement: `${process.cwd()}/` },
    { find: /^node:/, replacement: join(appRoot, "node-stub.ts") },
  ];
  // 外置说明符要写成"联邦地址"，同步回调里查不了异步的东西：先把行清单读出来算成两张表。
  // "我们的包"是**工作区里的所有包**（不只行清单里的）：`client-store` 这种不在行里，但它的联邦地址
  // 同样指向聚合产物（`client.js`），判成三方就会去找 `index.js`。
  const ownNamesOf = async (): Promise<ReadonlySet<string>> =>
    new Set((await ownVersionsOf()).keys());
  const ownVersionsOf = async (): Promise<ReadonlyMap<string, string>> => {
    // 版本表要覆盖**工作区里的所有包**：外置说明符里会出现没进行清单的（cordis、client-store…），
    // 而联邦地址必须带版本。行清单里的包版本从行里取，其余从各自的清单读（读一次缓存）。
    const versions = new Map((await sourceRowsOf()).map((row) => [row.id, row.version]));
    const packages = await workspacePackagesMatching(join(await profileRootOf(), "package.json"), [/.*/u]);
    for (const pkg of packages) {
      if (versions.has(pkg.name)) continue;
      const manifest = await manifestOf(pkg.root).catch(() => undefined);
      if (manifest !== undefined) versions.set(pkg.name, manifest.version);
    }
    return versions;
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
    const rest = url.slice(`${CLIENT_MODULES_PREFIX}/`.length).split("?")[0] ?? "";
    const slash = rest.indexOf("/");
    if (slash <= 0) return false;
    const pkgVersion = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    // scope 的 `@` 在前、版本分隔的在后：从**最后一个** `@` 切。
    const at = pkgVersion.lastIndexOf("@");
    if (at <= 0) return false;
    const name = decodePackageName(pkgVersion.slice(0, at));
    const version = pkgVersion.slice(at + 1);
    // 入口：我们的包按 `exports` 找 client 半；三方按 node 的解析找。之后**同一条链**。
    const resolvedRoot = await rootOf(name);
    // "我们的包" = **仓库内**的包：`rootOf` 对 node_modules 里的三方同样会解析成功，
    // 但那些不是我们的源码（它们的产物名与出口都不同）。
    const ownRoot =
      resolvedRoot !== undefined && !resolvedRoot.includes(`${sep}node_modules${sep}`)
        ? resolvedRoot
        : undefined;
    const ownEntry =
      ownRoot === undefined
        ? undefined
        : ((await exportTargetOf(ownRoot, "client")) ?? (await exportTargetOf(ownRoot, undefined)));
    const dependency =
      ownEntry === undefined
        ? await dependencyEntry(join(process.cwd(), "package.json"), name).catch(() => undefined)
        : undefined;
    const entry = ownEntry ?? dependency?.entry;
    if (entry === undefined) {
      process.stderr.write(
        `[federation] ${name}: 解析不到入口（工作区=${String(ownRoot !== undefined)}）\n`,
      );
      return false;
    }
    const bundled = await bundlePackage({
      cacheRoot,
      repoRoot: process.cwd(),
      alias: federationAlias,
      name,
      version: ownRoot === undefined ? (dependency?.version ?? version) : version,
      input: ownEntry === undefined ? { index: entry } : { client: entry },
      watch: ownRoot === undefined ? [entry] : [join(ownRoot, "src")],
      own: ownRoot !== undefined,
      versions: await ownVersionsOf(),
      ownNames: await ownNamesOf(),
    }).catch((error: unknown) => {
      process.stderr.write(`[federation] ${name} 构建失败: ${String(error)}\n`);
      return undefined;
    });
    if (bundled === undefined) {
      process.stderr.write(`[federation] ${name}: 产出为空（entry=${entry}）\n`);
      return false;
    }
    const target =
      bundled.files.get(file) ?? bundled.files.get(file.replace(/\.js$/u, "")) ?? bundled.files.get("client");
    if (target === undefined) return false;
    const code = await readFile(join(cacheRoot, target), "utf8").catch(() => undefined);
    if (code === undefined || code === "") return false;
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : code);
    return true;
  };

  const serveAny = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    process.stderr.write(`[serveAny] ${req.url ?? ""}
`);
    // `@/{filepath}` = **本地文件**（与源码里 import 的 alias 同一套写法）：浏览器 URL 不走 alias 解析，
    // 所以在这里落成 vite 认的根相对路径。
    const rawUrl = req.url ?? "";
    if (rawUrl.startsWith("/@/")) {
      const query = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
      req.url = `/${(rawUrl.slice(3).split("?")[0] ?? "")}${query}`;
    }
    const requestUrl = (req.url ?? "").split("?")[0] ?? "";
    if (requestUrl.startsWith(`${CLIENT_MODULES_PREFIX}/`)) {
      if (await serveFederation(requestUrl, req, res)) return;
    }
    try {
      await ensureVite();
    } catch (error) {
      ctx.logger.error(error);
    }
    // 先交给 vite（页面、入口、HMR 通道都是它的）；它不认的再回上游兜底。
    if (viteHandoff !== undefined && viteHandoff.serve(req, res)) return;
    return fallback(req, res);
  };
  // 用与上游同一个 API 占**兜底位**（`registerFallback`）：页面、入口、依赖预打包产物与 HMR 通道都是
  // vite 的；上游 `frontend-static` 那一行（挂在 `web-runtime` 上）在 dev patch 里已停用。
  ctx.effect(() => webServer.registerFallback(serveAny), "client-modules: vite 兜底");
  // 启动即预热：vite dev server 起来那一刻打出访问地址（跟它自己的 ready 提示一个意思），
  // 也把首屏要用的模块图先备好——懒建会让第一条请求等它冷启动。
  void ensureVite().catch((error: unknown) => { ctx.logger.error(error); });
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
