import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { COMBO_PATH } from "./combo.ts";
import {
  clientAssetPlugin,
  cssInlinePlugins,
} from "@local/devkit";
import {
  bundleExport,
  dependencyEntryOf,
  encodePackageName,
  exportSegmentOf,
  exportTargetOf,
  owningPackageOf,
  parsePluginAddress,
  manifestOf,
  packageRootOf,
  PLUGIN_ROUTE,
} from "./modules.ts";

export const name = "dev-client-bundles";

export const inject = ["webServer", "clientModules"];


// 打包器（`@local/devkit` 的现场打包面，连带 rolldown 与它的原生绑定）按需加载：打包产物里的行
// 已经切成 dist，这一支一次都不会走——常驻它等于给每个宿主进程白加一份打包器的内存。
interface RouteHost {
  /** 把注入表（boot 数据、引导器、script 行）渲染进一份 index.html 骨架。 */
  renderIndex(html: string): string;
  register(route: {
    // `prefix` 匹配 `p` 与 `p/<anything>`（上游 webServer 的原生能力）：按文件寻址要用它。
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}

interface ModuleTable {
  graph(): { entries: readonly { id: string }[] };
  clientPath(id: string): string | undefined;
  fetchBundle(request: Request): Promise<Response>;
}

export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as RouteHost | undefined;
  const modules = ctx.get("clientModules") as ModuleTable | undefined;
  if (webServer === undefined || modules === undefined)
    throw new Error("dev-client-bundles: webServer and clientModules are required services");

  // 包名 → 包根：交给 node 的解析（`createRequire(from).resolve`），不自己扫目录。
  // 基准是**发起引用的那个文件**——node 的规则就是这样，pnpm 的 node_modules 也按依赖关系摆好了。
  // 没有 importer 的场合（我们自己生成的入口），退到模块表里任一 client 行当基准（它们都在有依赖的包里）。
  let fallbackBase: string | undefined;
  // 只按**包名**解析（不带子路径）：`resolve('pkg/subpath')` 要求清单有对应的 `exports` 键，而很多包的
  // 子路径是要另外解的（`oniguruma-parser/parser` 这种）。包根拿到之后，子路径再按 `exports` 落文件。
  const rootOf = async (name: string, from?: string): Promise<string | undefined> => {
    const bases = from === undefined ? [] : [from];
    fallbackBase ??= modules.clientPath(modules.graph().entries[0]?.id ?? "") ?? undefined;
    if (fallbackBase !== undefined) bases.push(fallbackBase);
    for (const base of bases) {
      const found = await packageRootOf(base, name);
      if (found !== undefined) return found.root;
    }
    return undefined;
  };

  const fallback = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let response: Response;
    try {
      response = await modules.fetchBundle(
        new Request(new URL(req.url ?? COMBO_PATH, "http://dsh.invalid"), {
          method: req.method ?? "GET",
        }),
      );
    } catch (error) {
      ctx.logger.error(error);
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("dev-client-bundles: clientModules.fetchBundle failed\n");
      return;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    res.writeHead(response.status, headers);
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  };

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") return fallback(req, res);
    // 1) 我们自己的入口（生成的装配脚本）。
    if (await serveAppEntry(req, res)) return;
    // 2) 统一资源路径：`/plugins/<pkg>/<version>/<export>`——仓库包与三方包同格式。
    const address = parsePluginAddress(req.url ?? "");
    if (address !== undefined) {
      try {
        const code = await bundlePackage(address.name, address.exportName);
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
  const packageCache = new Map<string, string>();
  const bundlePackage = async (name: string, exportName: string): Promise<string | undefined> => {
    // 键是 (包, 出口)：同一个包的不同出口是不同产物。
    const key = `${name}#${exportName}`;
    const cached = packageCache.get(key);
    if (cached !== undefined) return cached;
    const root = await rootOf(name);
    if (root === undefined) return undefined;
    const entry =
      (await exportTargetOf(root, exportName === "." ? undefined : exportName.slice(2))) ??
      (await dependencyEntryOf(name, fallbackBase ?? root));
    if (entry === undefined) return undefined;
    const code = await bundleExport({
      root,
      entry,
      // 跨包引用 → 对方的**同格式** URL。目标包由 rolldown 解析出的**绝对路径**反推：
      // 只有落在我们自己目录下（工作区 / 上游源码）才 external，`node_modules` 一律 inline。
      rewrite: async (specifier: string, resolvedId: string) => {
        const owned = await owningPackageOf(resolvedId);
        if (owned === undefined) return undefined;
        // **同包**引用（client 半 import 自己主出口的符号）必须 inline：external 到自己的出口 URL 会指到
        // client 那半，而符号在主出口里——`does not provide an export named …` 就是这么来的。
        if (owned.name === name) return undefined;
        // 目标是 **client 行**时一律引它的 `/client` 出口：只有那半导出 `apply` / `default`（装配要的），
        // 根出口是宿主半，浏览器里没有那些东西。其余按 specifier 的出口走。
        const subpath = specifier === owned.name ? undefined : specifier.slice(owned.name.length + 1);
        // 带子路径的按子路径（`@pkg/default-workspace` → `default-workspace`，那种符号在别的出口里）；
        // **裸包名**且目标是 client 行时引 `/client`——只有那半导出 `apply` / `default`。
        const segment =
          subpath === undefined
            ? modules.clientPath(owned.name) === undefined
              ? exportSegmentOf(".")
              : "client"
            : exportSegmentOf(`./${subpath}`);
        return `${PLUGIN_ROUTE}/${encodePackageName(owned.name)}/${owned.version}/${segment}`;
      },
      plugins: [...cssInlinePlugins({ name, assets: "inline" }), clientAssetPlugin()],
    });
    packageCache.set(key, code);
    // 文件名里带上包名与出口（`/` 与 `@` 换成可读又安全的形式），方便直接定位。
    const fileName = `${key.replace(/[/@]/gu, "_")}.js`;
    try {
      await mkdir(depsDir, { recursive: true });
      await writeFile(join(depsDir, fileName), code);
      ctx.logger.debug("dev-client-bundles: 预处理 %s → %s", key, join(depsDir, fileName));
    } catch (error) {
      ctx.logger.warn("dev-client-bundles: 落盘失败 %s", error);
    }
    return code;
  };

  async function clientEntryUrl(id: string): Promise<string | undefined> {
    const root = await rootOf(id);
    if (root === undefined) return undefined;
    const manifest = await manifestOf(root);
    if (manifest === undefined) return undefined;
    const target = await exportTargetOf(root, "client");
    if (target === undefined) return undefined;
    // 统一路径：与三方依赖同格式。
    return `${PLUGIN_ROUTE}/${encodePackageName(manifest.name)}/${manifest.version}/client`;
  }


  // 自研 app 入口：一个 `type="module"` 的 ESM 模块，按文件 import 每个 client 行的源码入口。
  // 上游那套引导器是 classic script + `__ModuleLoader__.load` 工厂（`system.ts` 的默认加载钩子），
  // 与按文件 ESM 互斥——所以这里不再让它加载资源，只**读**它的行清单（`graph().entries`）当列表。
  const APP_ENTRY_PATH = "/plugins/.app/entry.js";
  const serveAppEntry = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if ((req.url ?? "").split("?")[0] !== APP_ENTRY_PATH) return false;
    const rows = modules
      .graph()
      .entries.map((entry) => entry.id)
      .filter((id) => id !== "client-modules");
    // **按 `dsh.client.inject` 排序**：那是每个 client 行在清单里声明的依赖（"我生效前谁得先就绪"）。
    // 平铺 import 是不够的——提供服务的行还没加载，用它的行就生效了（`ui-layout` 缺 theme/locale/shortcuts
    // 就是这么来的：它们正是它 inject 里那几行提供的）。这里做一次拓扑排序，依赖先行。
    const depsOfRow = async (id: string): Promise<string[]> => {
      const root = await rootOf(id);
      if (root === undefined) return [];
      const manifest = await manifestOf(root);
      const client = (manifest as { dsh?: { client?: { inject?: unknown } } } | undefined)?.dsh?.client;
      const inject = client?.inject;
      return Array.isArray(inject) ? inject.filter((name): name is string => typeof name === "string") : [];
    };
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visitRow = async (id: string): Promise<void> => {
      if (ordered.includes(id) || visiting.has(id)) return;
      visiting.add(id);
      for (const dep of await depsOfRow(id)) await visitRow(dep);
      visiting.delete(id);
      if (rows.includes(id)) ordered.push(id);
    };
    for (const row of rows) await visitRow(row);
    // 依赖里可能有不在行集里的包（不该出现），补在末尾以免漏掉它的服务。
    for (const dep of rows) if (!ordered.includes(dep)) ordered.push(dep);
    const ids = ordered;
    // 自研装配：建一个客户端 Context，按模块表的顺序调用每个 client 行的 `apply`
    // （每个 client 入口就是这样导出的：`export { apply, inject }`）。上游那套是 classic script +
    // `__ModuleLoader__.load` 工厂，加载与装配绑在一起；这里把两件事分开——ESM 负责加载，这段负责装配。
    // cordis 客户端的根出口 URL（统一路径：包/版本/出口）。
    const cordisRoot = await rootOf("@deepseek-ai/cordis", fallbackBase);
    const cordisManifest = cordisRoot === undefined ? undefined : await manifestOf(cordisRoot);
    const cordisUrl =
      cordisManifest === undefined
        ? undefined
        : `${PLUGIN_ROUTE}/${encodePackageName(cordisManifest.name)}/${cordisManifest.version}/_default`;
    const imports: string[] = [];
    const names: string[] = [];
    let index = 0;
    for (const id of ids) {
      const url = await clientEntryUrl(id);
      if (url === undefined) continue;
      const alias = `m${String(index)}`;
      index += 1;
      imports.push(`import * as ${alias} from ${JSON.stringify(url)};`);
      names.push(alias);
    }
    const lines: string[] = [
      "// dev 客户端入口：按出口 ESM 直访 + 本地装配（改哪看哪）。",
      // cordis 也走统一路径（它的根出口）。
      `import { Context } from ${JSON.stringify(cordisUrl ?? "/plugins/@deepseek-ai+cordis/0/_default")};`,
      ...imports,
      "",
      'console.log("[dsh] entry: modules loaded", ' + String(names.length) + ");",
      "const ctx = new Context();",
      // cordis 把 fiber 内的失败交给 `ctx.logger.error`（`fiber.ts:126`），而它在浏览器里默认不落 console
      // ——这就是"页面空白却无报错"的原因。先把它接到 console，装配期的失败才看得见。
      'const originalError = ctx.logger?.error?.bind(ctx.logger);',
      "if (ctx.logger !== undefined) {",
      "  ctx.logger.error = (...args) => {",
      '    console.error("[dsh] cordis error", ...args);',
      "    if (originalError !== undefined) originalError(...args);",
      "  };",
      "}",
      "globalThis.__DSH_CTX__ = ctx;",
      'console.log("[dsh] entry: context created");',
      // 每个 client 行导出 `{ apply, inject }`——**交给 cordis 的 plugin 机制**装配，不要手工调 apply：
      // 它按 `inject` 等依赖就绪、按声明顺序生效，手工调用会在服务还没注册时就去用（`undefined.register`）。
      `const ROW_IDS = ${JSON.stringify(ids)};`,
      `for (const [index, mod] of [${names.join(", ")}].entries()) {`,
      // client 行的导出有两种形状：`{ apply, inject }`（多数）与 `{ default: X }`（如
      // `dsh-client-shortcuts` 导出 `ShortcutsService as default`）。两种都要认。
      // 两种形状：`{ apply, inject }` 与 `{ default: X }`（如 `dsh-client-shortcuts` 导出
      // `ShortcutsService as default`）。整块交给 cordis——**不要**自己拼 `{ apply: factory.apply }`：
      // default 形状的 `factory` 上没有 `apply`，那样会取到 `Function.prototype.apply`（
      // `Function.prototype.apply was called on #<Object>…`）。
      '  const plugin = typeof mod.apply === "function" ? mod : (mod.default ?? undefined);',
      '  if (plugin === undefined) { console.warn("[dsh] skip (no apply/default)", index); continue; }',
      "  try {",
      '    console.log("[dsh] plugin", index, ROW_IDS[index] ?? plugin.name ?? "-", "inject:", JSON.stringify(plugin.inject ?? []));',
      '    ctx.plugin(plugin, { name: plugin.name ?? "client-" + index });',
      "  } catch (error) {",
      '    console.error("[dsh] plugin failed at", index, error);',
      "  }",
      "}",
      'console.log("[dsh] entry: plugins registered");',
      // 最后一步是**挂载**：`ui-renderer` 只提供 `uiRenderer.mount` 能力，调用它的是 boot kernel
      // （上游 `mountClient` 就一句话：等 `uiRenderer` 就绪后在 effect 里挂进容器）。这里做同一件事。
      'const container = document.getElementById("app");',
      'if (container === null) throw new Error("[dsh] entry: #app 挂载点不存在");',
      // 挂载要等 **'root' slot 真的注册**：`layout` 服务在注册之前就已提供（`ui-layout` 的 apply 里
      // `provide('layout')` 在 `slots.register({name:'root'})` 之前），所以等它不够——那时挂载会渲染
      // 一棵空树，之后 slot 注册也不会补渲。
      // 注意 `ctx.slots` 此刻可能是 undefined（它由 ui-renderer 的 apply 提供），直接取会抛错、
      // 让这个 Promise 永不 resolve。用可选链 + 上限轮询（约 10 秒）。
      'for (let i = 0; i < 600 && (ctx.slots?.entries?.("root")?.length ?? 0) === 0; i += 1) {',
      "  await new Promise((resolve) => setTimeout(resolve, 16));",
      "}",
      'console.log("[dsh] entry: root slot ready");',
      'await ctx.inject(["uiRenderer"], (scope) => {',
      '  scope.effect(() => scope.uiRenderer.mount(container), "dev entry: application mount");',
      "});",
      // 诊断：`ui-layout` 注册 'root' slot，它的 inject 是这几个服务；谁没就绪就说明缺哪一环。
      'for (const name of ["slots", "theme", "locale", "shortcuts", "uiRenderer", "connection", "typert", "remote", "configForms"]) {',
      '  console.log("[dsh] service", name, ctx[name] === undefined ? "缺" : "有");',
      "}",
      'console.log("[dsh] entry: mounted");',
    ]
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : `${lines.join("\n")}\n`);
    return true;
  };

  /**
   * 去掉上游客户端那一套的注入：引导器（`<script>` / `<link rel=preload>` 里的
   * `plugins/??<id>/client.js` 引用）、内联的 `__DSH_BOOT__` 与 `__ModuleLoader__` 引导器。
   *
   * 资源的加载改由我们的入口按**统一路径**（`/plugins/<pkg>/<version>/<export>`）import；上游那套是
   * classic script + 工厂注册（`__ModuleLoader__.load`），与 ESM 互斥，留着只会引发无用请求与报错。
   * 按**标签**扫而不是按 `<script>` 扫：preload 是 `<link>`，之前就是这里漏了。
   */
  const upstreamMarkers = ["plugins/??", "__DSH_BOOT__", "__ModuleLoader__"];
  const stripUpstreamBoot = (html: string): string => {
    let out = "";
    let cursor = 0;
    for (;;) {
      const candidates = ["<script", "<link"]
        .map((tag) => html.indexOf(tag, cursor))
        .filter((index) => index >= 0);
      if (candidates.length === 0) break;
      const start = Math.min(...candidates);
      const tag = html.startsWith("<script", start) ? "script" : "link";
      const end = html.indexOf(">", html.indexOf(`${tag === "script" ? "</script" : ""}`, start) + 1);
      // `<link …>` 以 `>` 结尾；`<script …>…</script>` 要连内容一起吃掉（内联引导器就在里面）。
      const close = tag === "script" ? html.indexOf("</script>", start) : -1;
      const stop = close < 0 ? end + 1 : close + "</script>".length;
      const block = html.slice(start, stop);
      const upstream = upstreamMarkers.some((marker) => block.includes(marker));
      out += html.slice(cursor, start) + (upstream ? "" : block);
      cursor = stop;
    }
    return out + html.slice(cursor);
  };

  const serveIndex = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const rendered = stripUpstreamBoot(webServer.renderIndex(indexHtml));
      const html = `${rendered}\n<script type="module" src="${APP_ENTRY_PATH}"></script>\n`;
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : html);
    } catch (error) {
      ctx.logger.error(error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  };
  ctx.effect(() => webServer.register({ kind: "exact", path: "/", handler: serveIndex }), "dev-client-bundles: index");
  ctx.effect(
    () => webServer.register({ kind: "exact", path: "/index.html", handler: serveIndex }),
    "dev-client-bundles: /index.html",
  );

  ctx.effect(
    // `prefix /plugins`：combo（`/plugins/??a,b`）与按文件寻址（`/plugins/<pkg>/<version>/<file>`）都从
    // 这一个入口进来，在 handler 里按 `req.url` 分发。
    () => webServer.register({ kind: "prefix", path: PLUGIN_ROUTE, handler: serve }),
    "dev-client-bundles: /plugins route",
  );
}
