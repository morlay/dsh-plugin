// 生产态的前端资产：**读一个目录，投文件**。没有 vite、没有构建、没有缓存失效。
//
// 它是 `ClientAssets` 的 prod 实现（契约在 `./client-assets.contract.ts`），住在 `zephyr-app`：
// 生产态只做文件投递，不该为它把构建链拖进运行时（设计决定 5、判据 3）。
// 目录由装配面给（`configure(StaticClientAssets, { dir })`）：`AppEnv` 只放两种形态都成立的事实，
// `client_modules/` 只有生产态才有。
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { Injectable } from "@morlay/zephyr";
import { CLIENT_MODULES_PREFIX, ClientAssets } from "./client-assets.contract.ts";

/** 扩展名 → MIME。**只认产出里会出现的那些**，其余一律 404（不做八面玲珑的 MIME 表）。 */
const MIME: Readonly<Record<string, string>> = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
};

/** 静态目录的位置（装配面经 `configure` 给）。 */
export interface StaticClientAssetsOptions {
  /** `<outputDir>/client_modules` 的绝对路径。 */
  readonly dir?: string;
}

@Injectable()
export class StaticClientAssets extends ClientAssets {
  private readonly dir: string;

  /**
   * @param options - 静态目录（**装配面必须给**：`productionProviders({ clientModulesDir })` 传进来）。
   * @throws Error 没给目录（装配错误：静默用 `process.cwd()` 会在打包形态指错地方）。
   */
  constructor(options: StaticClientAssetsOptions = {}) {
    super();
    const dir = options.dir;
    if (dir === undefined || dir === "") {
      throw new Error(
        "StaticClientAssets 没有目录可投：装配面必须给 dir（productionProviders 会传 client_modules）。",
      );
    }
    this.dir = dir;
  }

  /**
   * 按地址投文件：`/_zephyr/@modules/<pkg>@<ver>/<file>` → 磁盘上的同名相对路径。
   *
   * `?v=` 只是浏览器缓存区分用的 query，**服务端忽略**（设计 §四）。其余地址按静态目录里的相对路径直接取
   * （`/index.html`、`/`）——静态目录本身就是「URL ↔ 文件」一一对应。
   * @param req - 进来的请求。
   * @param res - 应答的对象。
   * @returns 已应答为 `true`；不归它（不存在 / 不认识的扩展名）为 `false`。
   */
  async serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const relative = this.relativeOf(path);
    if (relative === undefined) return false;
    // **越界一律不认**：`../` 在地址里出现就等于想读出静态目录（`normalize` 之后仍以 `..` 开头即拒绝）。
    const normalized = normalize(relative).split(sep).join("/");
    if (normalized.startsWith("..") || normalized.startsWith("/")) return false;
    const file = join(this.dir, normalized);
    const bytes = await readFile(file).catch(() => undefined);
    if (bytes === undefined) return false;
    const type = MIME[extname(file).slice(1).toLowerCase()];
    if (type === undefined) return false;
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : bytes);
    return true;
  }

  /**
   * 页面骨架原样返回：生产态的入口地址在 `compile()` 时就写进 `index.html` 了，
   * 运行期不再改写（没有第二条真相）。
   * @param html - 骨架原文。
   * @returns 原样。
   */
  async transformHtml(html: string): Promise<string> {
    return html;
  }

  /** 生产态没有 HMR 通道。 */
  get hmr(): boolean {
    return false;
  }

  /**
   * 生产态没有变更源：返回一个空撤销函数（契约要求可调）。
   * @returns 撤销函数（什么都不做）。
   */
  onServerSourceChange(_listener: (file: string) => void): () => void {
    return () => {};
  }

  /**
   * 地址 → 静态目录里的相对路径。
   * @param path - 已去掉 query 的路径。
   * @returns 相对路径；不归它管的地址（不是联邦地址、也不是已存在的静态文件形态）为 `undefined`。
   */
  private relativeOf(path: string): string | undefined {
    if (path.startsWith(`${CLIENT_MODULES_PREFIX}/`)) {
      return decodeURIComponent(path.slice(CLIENT_MODULES_PREFIX.length + 1));
    }
    if (path === "/" || path === "") return "index.html";
    if (path.startsWith("/")) return path.slice(1);
    return undefined;
  }
}

/**
 * 目录在不在（preview 的装配前校验用它：缺 `client_modules/` 就别起服务）。
 * @param dir - 绝对路径。
 * @returns 判断结果。
 */
export async function isDirectory(dir: string): Promise<boolean> {
  return stat(dir).then(
    (info) => info.isDirectory(),
    () => false,
  );
}
