import { access, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { COMBO_PATH, comboEntryIds, singleEntryId, stripSourceMapTrailer } from "./combo.ts";
import {
  clientAssetPlugin,
  compileCssModule,
  compileGlobalCss,
  cssInlinePlugins,
  prebundleDependency,
} from "@local/devkit";
import {
  bundleExport,
  dependencyEntryOf,
  encodePackageName,
  exportTargetOf,
  packageNameOf,
  manifestOf,
  owningPackageOf,
  packageRootOf,
  parseExportAddress,
  parseFileAddress,
  PLUGIN_ROUTE,
  resolveBareUrl,
  resolveInPackage,
  transpileFile,
} from "./modules.ts";

export const name = "dev-client-bundles";

// 资产 MIME：按扩展名原样下发（与 devkit 的 CSS 资产表同集合）。
const ASSET_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

export const inject = ["webServer", "clientModules"];


// 打包器（`@local/devkit` 的现场打包面，连带 rolldown 与它的原生绑定）按需加载：打包产物里的行
// 已经切成 dist，这一支一次都不会走——常驻它等于给每个宿主进程白加一份打包器的内存。
const loadBundler = async (): Promise<typeof import("@local/devkit").bundleClientFactory> =>
  (await import("@local/devkit")).bundleClientFactory;

export interface Config {
  // 显式点名的包：client 出口是**产物**（`.js`）但也要现场打包时用它压过默认判据。
  packages?: string[];
}

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

// 源码后缀：`clientPath` 命中它就意味着这一行还没有构建产物，需要现场打包。
const SOURCE_ENTRY = /\.[cm]?tsx?$/;

function escapeRegExp(value: string): string {
  return value.replace(/[/\\^$*+?.()|[\]{}]/gu, "\\$&");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function clientEntryOf(clientPath: string): Promise<{ root: string; entry: string }> {
  let directory = dirname(clientPath);
  while (directory !== dirname(directory)) {
    if (await pathExists(join(directory, "package.json")))
      return { root: directory, entry: join(directory, "src", "client", "index.ts") };
    directory = dirname(directory);
  }
  throw new Error(`dev-client-bundles: no package root above ${clientPath}`);
}

export function apply(ctx: Context, config: Config = {}): void {
  const webServer = ctx.get("webServer") as RouteHost | undefined;
  const modules = ctx.get("clientModules") as ModuleTable | undefined;
  if (webServer === undefined || modules === undefined)
    throw new Error("dev-client-bundles: webServer and clientModules are required services");

  const explicit = new Set(config.packages ?? []);

  // 包名 → 包根：交给 node 的解析（`createRequire(from).resolve`），不自己扫目录。
  // 基准是**发起引用的那个文件**——node 的规则就是这样，pnpm 的 node_modules 也按依赖关系摆好了。
  // 没有 importer 的场合（我们自己生成的入口），退到模块表里任一 client 行当基准（它们都在有依赖的包里）。
  let fallbackBase: string | undefined;
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
  const indexEntryOf = (name: string): Promise<string | undefined> => rootOf(name);
  // 模块表给的"行 id → client 源文件"；不在表里就走包索引（普通依赖、上游包、三方包都在这里）。
  const moduleEntryOf = (name: string): string | undefined => modules.clientPath(name);

  // 三方依赖的预打包产物落在这里（profile 的 store，跨进程复用）。
  const depsDir = join(process.env["DSH_HOME"] ?? join(process.cwd(), ".dsh-store"), "deps");

  // 现场打包的判据是「这一行的 client 出口指向源码」：`exports` 指到 `src/client/index.ts` 后，
  // `client-modules` 读到的就是 TS 源文件，直接下发会把 TS 当 JS 执行——浏览器要的是工厂脚本。
  // 源码面对上游与本仓库的包一视同仁（两边都是 `src`），所以判据只看出口指向，不看包名前缀：
  // 打包产物里 `@morlay/*` 的出口已切回 `dist`，按前缀判会把它们当源码行去找不存在的 `src`。
  const sourceRow = (id: string): boolean => {
    const path = modules.clientPath(id);
    return path !== undefined && SOURCE_ENTRY.test(path);
  };

  const needsBundle = (id: string): boolean => explicit.has(id) || sourceRow(id);

  // 留给模块表的行集：只匹配行入口与 `/client` 子路径。`.../remote`、`/display` 这类子路径不是行条目
  // （模块表按行注册），把它们当 external 会让整行在浏览器里 require 失败。
  const devExternals = (): (string | RegExp)[] =>
    modules
      .graph()
      .entries.map((entry) => entry.id)
      .filter(needsBundle)
      .map((id) => new RegExp(`^${escapeRegExp(id)}(?:/client)?$`));

  const builtPathOf = (id: string): string => {
    const path = modules.clientPath(id);
    if (path === undefined) throw new Error(`dev-client-bundles: ${id} is not a client module row`);
    return path;
  };

  const bundleSource = async (id: string, externals: (string | RegExp)[]): Promise<string> => {
    const clientPath = builtPathOf(id);
    const { root, entry } = await clientEntryOf(clientPath);
    // 源码行：`clientPath` 就是入口本身（`src/client/index.ts` 或 `src/client.ts`）；
    // 产物行（未改指源码的白名单出口）：沿用包内约定的 `src/client/index.ts`。
    const resolved = SOURCE_ENTRY.test(clientPath) ? clientPath : entry;
    if (!(await pathExists(resolved)))
      throw new Error(`dev-client-bundles: ${id} has no client source at ${resolved}`);
    // cwd 是**被打包的那个包**：external 判据读它自己的依赖清单（谁有 `exports["./client"]`），
    // 用 dev 进程的 cwd（工作区根）会漏掉我们的 client 行，把它们内联成第二份 factory。
    return await (await loadBundler())({ name: id, entry: resolved, externals, cwd: root });
  };

  const readBuilt = async (id: string): Promise<string> =>
    stripSourceMapTrailer(await readFile(builtPathOf(id), "utf8"));

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

  const prebundleUrl = async (specifier: string, fromFile: string, outDir: string): Promise<string | undefined> => {
    const entry = await dependencyEntryOf(specifier, fromFile);
    if (entry === undefined) return undefined;
    const name = packageNameOf(specifier);
    try {
      const result = await prebundleDependency({ name, entry, outDir });
      ctx.logger.debug("dev-client-bundles: 预打包 %s → %s", name, result.file);
      return `${PLUGIN_ROUTE}/.deps/${result.file}`;
    } catch (error) {
      ctx.logger.error(error);
      return undefined;
    }
  };

  // 按文件寻址：`/plugins/{pkg}/{version}/{filepath}`——仓库源码逐个文件转译直出，依赖由浏览器原生
  // ESM 解析。命中就自己下发，不再走 combo 打包。
  const serveFile = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    // 预打包产物：`/plugins/.deps/<file>` 直接从缓存目录读。
    const depsMatch = /^\/plugins\/\.deps\/([^?]+)/u.exec(req.url ?? "");
    if (depsMatch?.[1] !== undefined) {
      try {
        const code = await readFile(join(depsDir, basename(depsMatch[1])), "utf8");
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : code);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(`dev-client-bundles: 未预打包 ${depsMatch[1]}\n`);
      }
      return true;
    }
    // 按「包与出口」寻址：`/plugins/<pkg>/<export>` → 该出口打一份 ESM。
    const exportAddress = parseExportAddress(req.url ?? "");
    if (exportAddress !== undefined) {
      try {
        const root = await indexEntryOf(exportAddress.name);
        if (root === undefined) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end(`dev-client-bundles: 未知包 ${exportAddress.name}\n`);
          return true;
        }
        const manifest = await manifestOf(root);
        // `exportTargetOf` 的 subpath 不带 `./`（根出口传 undefined）。
        const subpath = exportAddress.exportName === "." ? undefined : exportAddress.exportName.slice(2);
        const entry = await exportTargetOf(root, subpath);
        if (manifest === undefined || entry === undefined) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end(`dev-client-bundles: ${exportAddress.name} 没有出口 ${exportAddress.exportName}\n`);
          return true;
        }
        const code = await bundleExport({
          root,
          entry,
          // 包内（相对导入、同包引用）inline；跨包 external 成对方**出口的 URL**；三方依赖走**预处理**
          // （打成一份 ESM 缓存到 `.deps/`）——它们不是工作区包，没有源码面的出口可指。
          // 解析不到**报错**：静默 external 只会让浏览器拿到一个 404，把问题推后。
          rewrite: async (specifier: string) => {
            if (specifier.startsWith(".")) return undefined;
            const target = packageNameOf(specifier);
            if (target === exportAddress.name) return undefined;
            const subpath = specifier === target ? undefined : specifier.slice(target.length + 1);
            const targetRoot = await rootOf(target, entry);
            if (targetRoot !== undefined && !targetRoot.includes(`${sep}node_modules${sep}`)) {
              const targetManifest = await manifestOf(targetRoot);
              if (targetManifest === undefined) {
                throw new Error(`dev-client-bundles: ${target} 的包清单读不到（${targetRoot}）`);
              }
              return `${PLUGIN_ROUTE}/${encodePackageName(targetManifest.name)}/${subpath === undefined ? "_" : subpath}`;
            }
            // 三方依赖：预处理成 `.deps/<name>-<hash>.js`。
            const entryFile = await dependencyEntryOf(specifier, entry);
            if (entryFile === undefined) {
              throw new Error(
                `dev-client-bundles: 解析不到 ${specifier}（从 ${entry} 出发，包 ${exportAddress.name}）`,
              );
            }
            const bundled = await prebundleDependency({ name: target, entry: entryFile, outDir: depsDir });
            return `${PLUGIN_ROUTE}/.deps/${bundled.file}`;
          },
          // 样式内联 + 资产内联（`.svg` / 字体转 data URI）：产物是自包含单文件，缺这两样
          // rolldown 会把 `.svg` 当 JS 解析（PARSE_ERROR）。
          plugins: [
            ...cssInlinePlugins({ name: exportAddress.name, assets: "inline" }),
            clientAssetPlugin(),
          ],
        });
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
      return true;
    }
    const address = parseFileAddress(req.url ?? "");
    if (address === undefined) return false;
    // 包根从模块表推：`clientPath(id)` 给的就是该包的 client 源文件（`exports` 已指 `src`），
    // 沿它向上找清单即可。用 `require.resolve` 不行——dev 进程是 dsh-desktop-host，它的依赖清单里
    // 没有业务包。
    const clientPath = modules.clientPath(address.name);
    const owner = clientPath === undefined ? undefined : await owningPackageOf(clientPath);
    const root = owner?.root ?? (await packageRootOf(import.meta.filename, address.name))?.root;
    if (root === undefined) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`dev-client-bundles: 未知包 ${address.name}\n`);
      return true;
    }
    const pkg = await manifestOf(root);
    if (pkg === undefined) return false;
    const file = resolveInPackage({ ...pkg, root }, address.filepath);
    if (file === undefined) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("dev-client-bundles: 越界路径\n");
      return true;
    }
  
  // 只改**裸导入**：URL 结构镜像了文件结构（`/plugins/<pkg>/<v>/src/client/x.ts`），包内的相对导入
    // 原样留着浏览器自己拼就对（`../shared.ts` → 同包同版本的 `src/shared.ts`），改写反而多一层。
    // 裸导入（含 `@pkg/subpath`）用模块表解析到目标包的源文件，再拼成绝对 URL。
    const rewrite = async (specifier: string): Promise<string | undefined> => {
      // 仓库内绝对路径（`/vendor/deepseek-harness/packages/…/x.tsx` 这种写法源码里也有）照样改写成
      // 按文件 URL；相对导入留给浏览器自己拼（URL 结构镜像文件结构）。
      if (specifier.startsWith("/")) return await absoluteToPluginUrl(specifier);
      if (specifier.startsWith(".") || specifier.startsWith("node:")) return undefined;
      const resolved = await resolveBareUrl(specifier, file, moduleEntryOf, indexEntryOf);
      // 仓库自己的包（工作区与上游源码）逐文件直出；`node_modules` 里的**三方包**不行——它们大量是
      // CJS，得整包预打包成单个 ESM（vite 的 optimizeDeps 那一层）。
      if (resolved?.via === "source") return resolved.url;
      return await prebundleUrl(specifier, file, depsDir);
    };
    // 资产（图片、字体）：原样下发，带上 MIME。它们不是模块，转译会直接失败。
    if (ASSET_MIME[file.split(".").pop()?.toLowerCase() ?? ""] !== undefined) {
      try {
        const bytes = await readFile(file);
        res.writeHead(200, {
          "content-type": ASSET_MIME[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : bytes);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("dev-client-bundles: 资产不存在\n");
      }
      return true;
    }
    // 样式：编译成"注入 style + 导出 class 映射"的 ESM（与 rolldown 插件那条链同一份实现），
    // 否则浏览器把 CSS 文本当 JS 解析会直接报错。
    if (file.endsWith(".module.css") || file.endsWith(".css")) {
      try {
        const source = await readFile(file, "utf8");
        const code = file.endsWith(".module.css")
          ? await compileCssModule(file, source)
          : await compileGlobalCss(file, source);
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
      return true;
    }
    try {
      const code = await transpileFile({ file, rewrite });
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
    return true;
  };

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? COMBO_PATH;
    if (req.method !== "GET" && req.method !== "HEAD") return fallback(req, res);
    if (await serveAppEntry(req, res)) return;
    if (await serveFile(req, res)) return;
    // combo（`??a/client.js,b/client.js`）与单包（`/<id>/client.js`）都要现场打包：源码行下发的
    // 字节若走 clientModules，会把 TS 原文当 JS 执行。包内 chunk 仍交给 clientModules。
    const combo = comboEntryIds(url);
    const single = combo === undefined ? singleEntryId(url) : undefined;
    const ids = combo ?? (single === undefined ? undefined : [single]);
    if (ids === undefined || !ids.some(needsBundle)) return fallback(req, res);
    try {
      const externals = devExternals();
      const parts = await Promise.all(
        ids.map(async (id) => (needsBundle(id) ? await bundleSource(id, externals) : readBuilt(id))),
      );
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : parts.join("\n"));
    } catch (error) {
      ctx.logger.error(error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`${error instanceof Error ? error.message : String(error)}\n`);
    }
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
  // 页面里的 client 资源引用（入口脚本、boot 的 `batches`/`entries`）都按 combo 形状写：
  // `plugins/??<id>/client.js&rev=<hash>`。那是模块表的地址——按文件直访把它们换成
  // `/plugins/<pkg>/<version>/src/client/index.ts`，浏览器就能原生 ESM 直接加载。
  // 多包 combo（`??a,b`，真合并）不在替换范围内，保留给上游的 combo 路由兜底。
  // 页面里的 client 资源引用（入口脚本、boot 的 `batches`/`entries`）都按 combo 形状写：
  // `plugins/??<id>/client.js&rev=<hash>`（HTML 里 `&` 是实体）。那是模块表的地址，按文件直访要把它们
  // 换成 `/plugins/<pkg>/<version>/src/client/index.ts`，浏览器才能原生 ESM 加载。
  //
  // 用「找标记 + 手工切」而不是正则：这里的形状固定（`plugins/??` 起、`client.js` 止、后面跟引号或空白），
  // 字符串扫描比在转义环境里调正则稳得多。
  const CLIENT_REF_START = "plugins/??";
  const CLIENT_REF_END = "/client.js";
  const rewriteClientUrls = async (html: string): Promise<string> => {
    let out = "";
    let cursor = 0;
    for (;;) {
      const start = html.indexOf(CLIENT_REF_START, cursor);
      if (start < 0) break;
      const idStart = start + CLIENT_REF_START.length;
      const idEnd = html.indexOf(CLIENT_REF_END, idStart);
      if (idEnd < 0) break;
      const id = html.slice(idStart, idEnd);
      // 多包 combo（`??a,b`，真合并）不在替换范围：那是模块表的能力，保留给它的 combo 路由。
      const url = id.includes(",") ? undefined : await clientEntryUrl(id);
      // 引用结束于 `client.js` 之后的第一个引号或空白（`&rev=…` 一类的 query 一并吃掉）。
      let tail = idEnd + CLIENT_REF_END.length;
      while (tail < html.length && html[tail] !== '"' && html[tail] !== "'" && !/\s/u.test(html[tail] ?? "")) {
        tail += 1;
      }
      out += html.slice(cursor, start) + (url ?? html.slice(start, tail));
      cursor = tail;
    }
    return out + html.slice(cursor);
  };

  /** 包 id → 按文件入口 URL（包清单的 client 出口 → 源文件）。 */
  /** 仓库内绝对路径 → 按文件 URL（`/vendor/…/packages/<组>/<包>/src/x.tsx`）。 */
  async function absoluteToPluginUrl(specifier: string): Promise<string | undefined> {
    const marker = "/packages/";
    const index = specifier.indexOf(marker);
    if (index < 0) return undefined;
    const name = specifier.slice(0, index).split("/").pop();
    if (name === undefined) return undefined;
    const rest = specifier.slice(index + marker.length);
    const [group, pkgName, ...tail] = rest.split("/");
    if (group === undefined || pkgName === undefined || tail.length === 0) return undefined;
    for (const candidate of [`@deepseek-ai/dsh-${pkgName}`, pkgName]) {
      const entry = await indexEntryOf(candidate);
      if (entry === undefined) continue;
      const target = resolvePath(entry, tail.join("/"));
      if (!target.startsWith(entry)) continue;
      try {
        await access(target);
      } catch {
        continue;
      }
      const manifest = await manifestOf(entry);
      if (manifest === undefined) continue;
      return `${PLUGIN_ROUTE}/${encodePackageName(manifest.name)}/${manifest.version}/${relative(entry, target).split(sep).join("/")}`;
    }
    return undefined;
  }

  async function clientEntryUrl(id: string): Promise<string | undefined> {
    const indexed = await indexEntryOf(id);
    if (indexed === undefined) return undefined;
    const manifest = await manifestOf(indexed);
    const target = await exportTargetOf(indexed, "client");
    if (manifest === undefined || target === undefined) return undefined;
    // 一个出口一份产物：引用的是**出口**，不是文件。
    return `/plugins/${encodePackageName(manifest.name)}/client`;
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
      'import { Context } from "/plugins/@deepseek-ai+cordis/_";',
      ...imports,
      "",
      "const ctx = new Context();",
      "globalThis.__DSH_CTX__ = ctx;",
      `for (const mod of [${names.join(", ")}]) {`,
      '  if (typeof mod.apply === "function") await mod.apply(ctx);',
      "}",
    ]
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : `${lines.join("\n")}\n`);
    return true;
  };

  /**
   * 去掉上游客户端那一套的注入：引导器（`<script src="plugins/??…">`）、bootstrap/application 的
   * `script-src`/`script-preload` 行，以及内联的 `__DSH_BOOT__` + 模块表引导器。资源的加载改由我们的
   * 入口（`/plugins/.app/entry.js`）按**出口** import，模块表的那套协议（classic script +
   * `__ModuleLoader__.load`）与按出口 ESM 互斥，留着只会引发无用请求。
   */
  const stripUpstreamBoot = (html: string): string => {
    let out = "";
    let cursor = 0;
    for (;;) {
      const start = html.indexOf("<script", cursor);
      if (start < 0) break;
      const end = html.indexOf("</script>", start);
      const block = end < 0 ? html.slice(start) : html.slice(start, end + "</script>".length);
      // `__ModuleLoader__` 是模块表引导器的排队入口（classic script + 工厂协议），自研装配后它没有
      // 消费方；`plugins/??` 是 combo 引用；`__DSH_BOOT__` 是模块表的行清单。三类都清掉。
      const upstream =
        block.includes("plugins/??") ||
        block.includes("__DSH_BOOT__") ||
        block.includes("__ModuleLoader__");
      out += html.slice(cursor, start) + (upstream ? "" : block);
      if (end < 0) {
        cursor = html.length;
        break;
      }
      cursor = end + "</script>".length;
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
      const html = `${await rewriteClientUrls(rendered)}\n<script type="module" src="${APP_ENTRY_PATH}"></script>\n`;
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
