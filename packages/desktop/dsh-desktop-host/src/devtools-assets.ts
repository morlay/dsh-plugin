// 调试窗口的前端产物托管：桌面档没有端口，也不必依赖上游 inspector 行的 `/inspector/devtools` 路由
// （那条路由与它的 Worker 绑在一起）。壳在独立窗口里加载这里取到的 DevTools 前端，端点由 host 的
// Node inspector 给——决策见 [ADR 桌面档调试面用 Node inspector]。

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { DEVTOOLS_ASSETS_PREFIX } from "./paths.ts";

// 上游那份前端产物在运行时闭包里的相对位置（它随 `@deepseek-ai/dsh-experimental-inspector` 一起装）。
const ASSETS_SEGMENTS = [
  "node_modules",
  "@deepseek-ai",
  "dsh-experimental-inspector",
  "lib",
  "devtools",
];

// 产物里会出现的类型；其余按二进制流出去（前端自己按内容判断）。
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// 取前缀之后的那一段路径；解码失败或不是本前缀下的请求时返回 undefined。
function suffixOf(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith(`${DEVTOOLS_ASSETS_PREFIX}/`)) return undefined;
  const suffix = decoded.slice(DEVTOOLS_ASSETS_PREFIX.length);
  return suffix.includes("\0") ? undefined : suffix;
}

// 第一个装了这份产物的根：dev 形态是工程目录（profile 工程），打包形态是随包运行时。
async function findAssetsDir(roots: readonly string[]): Promise<string | undefined> {
  for (const root of roots) {
    const dir = join(root, ...ASSETS_SEGMENTS);
    try {
      if ((await stat(join(dir, "devtools_app.html"))).isFile()) return dir;
    } catch {
      // 这个根没装（或没装全）这份产物，换下一个。
    }
  }
  return undefined;
}

/**
 * 在 `webServer` 上挂调试窗口的前端产物路由；随插件 fiber 一起撤销。
 * @param ctx - 宿主 Cordis 插件上下文。
 * @param roots - 候选根（运行时目录、profile 工程目录）。
 */
export function installDevtoolsAssets(ctx: Context, roots: readonly string[]): void {
  let resolved: Promise<string | undefined> | undefined;
  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    resolved ??= findAssetsDir(roots);
    const dir = await resolved;
    if (dir === undefined) {
      ctx.logger.warn("dsh desktop: the devtools frontend is not bundled in this runtime");
      res.writeHead(404).end("devtools frontend is not bundled");
      return;
    }
    const suffix = suffixOf(new URL(req.url ?? "/", "http://app.invalid").pathname);
    if (suffix === undefined) {
      res.writeHead(404).end("not found");
      return;
    }
    const target = resolve(dir, `.${suffix}`);
    const within = relative(dir, target);
    if (within === "" || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, {
        "content-type": contentType(target),
        "content-length": String(body.byteLength),
        "cache-control": "no-cache",
      });
      if (req.method === "HEAD") res.end();
      else res.end(body);
    } catch (error) {
      ctx.logger.warn(
        `dsh desktop: devtools asset ${suffix} is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.writeHead(404).end("not found");
    }
  };
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: DEVTOOLS_ASSETS_PREFIX, handler: serve }),
    "dsh-desktop: devtools frontend assets",
  );
}
