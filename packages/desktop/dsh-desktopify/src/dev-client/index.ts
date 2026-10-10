import { access, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { bundleClientFactory } from "@local/devkit";
import { COMBO_PATH, comboEntryIds, singleEntryId, stripSourceMapTrailer } from "./combo.ts";

export const name = "dev-client-bundles";

export const inject = ["webServer", "clientModules"];

export interface Config {
  prefixes?: string[];

  packages?: string[];
}

interface RouteHost {
  register(route: {
    kind: "exact";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}

interface ModuleTable {
  graph(): { entries: readonly { id: string }[] };
  clientPath(id: string): string | undefined;
  fetchBundle(request: Request): Promise<Response>;
}

const DEFAULT_PREFIXES = ["@morlay/"];

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

  const prefixes = config.prefixes ?? DEFAULT_PREFIXES;
  const explicit = new Set(config.packages ?? []);
  const isDevPackage = (id: string): boolean =>
    explicit.has(id) || prefixes.some((prefix) => id.startsWith(prefix));

  // 现场打包的判据是「这一行的 client 出口指向源码」：`exports` 指到 `src/client/index.ts` 后，
  // `client-modules` 读到的就是 TS 源文件，直接下发会把 TS 当 JS 执行——浏览器要的是工厂脚本。
  const sourceRow = (id: string): boolean => {
    const path = modules.clientPath(id);
    return path !== undefined && SOURCE_ENTRY.test(path);
  };

  const needsBundle = (id: string): boolean => isDevPackage(id) || sourceRow(id);

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
    return await bundleClientFactory({ name: id, entry: resolved, externals, cwd: root });
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

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? COMBO_PATH;
    if (req.method !== "GET" && req.method !== "HEAD") return fallback(req, res);
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

  ctx.effect(
    () => webServer.register({ kind: "exact", path: COMBO_PATH, handler: serve }),
    "dev-client-bundles: /plugins route",
  );
}
