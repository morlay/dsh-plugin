import type { IncomingMessage, ServerResponse } from "node:http";
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
  packageNameOf,
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
    "  <body></body>",
    "</html>",
    "",
  ].join("\n");
  // 缓存键是 (包, 出口)：同一个包的不同出口是不同产物；dev 内存即可（内容 hash 作 rev 时再谈落盘）。
  const packageCache = new Map<string, string>();
  const bundlePackage = async (name: string, exportName: string): Promise<string | undefined> => {
    // 键是 (包, 出口)：同一个包的不同出口是不同产物。
    const key = `${name}\u0000${exportName}`;
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
      rewrite: async (specifier: string) => {
        if (specifier.startsWith(".")) return undefined;
        const target = packageNameOf(specifier);
        if (target === name) return undefined;
        // 跨包引用 → 对方的**同格式** URL（对方按需预处理）。
        const targetRoot = await rootOf(target, entry);
        if (targetRoot === undefined) {
          throw new Error(`dev-client-bundles: 解析不到 ${specifier}（从 ${entry} 出发）`);
        }
        const targetManifest = await manifestOf(targetRoot);
        if (targetManifest === undefined) {
          throw new Error(`dev-client-bundles: ${target} 的包清单读不到`);
        }
        // 同格式的对方 URL：出口按 specifier 的子路径（`@pkg/client` → `client`），rev 不带
        // （rev 由对方产物算出，带上就成循环）。
        const subpath = specifier === target ? undefined : specifier.slice(target.length + 1);
        const targetExport = subpath === undefined ? "." : `./${subpath}`;
        return `${PLUGIN_ROUTE}/${encodePackageName(targetManifest.name)}/${targetManifest.version}/${exportSegmentOf(targetExport)}`;
      },
      plugins: [...cssInlinePlugins({ name, assets: "inline" }), clientAssetPlugin()],
    });
    packageCache.set(key, code);
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
    const ids = modules
      .graph()
      .entries.map((entry) => entry.id)
      .filter((id) => id !== "client-modules");
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
      "globalThis.__DSH_CTX__ = ctx;",
      'console.log("[dsh] entry: context created");',
      `for (const [index, mod] of [${names.join(", ")}].entries()) {`,
      '  if (typeof mod.apply !== "function") continue;',
      "  try {",
      '    console.log("[dsh] apply", index, mod.inject ?? "");',
      "    await mod.apply(ctx);",
      "  } catch (error) {",
      '    console.error("[dsh] apply failed at", index, error);',
      "    throw error;",
      "  }",
      "}",
      'console.log("[dsh] entry: all applied");',
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
