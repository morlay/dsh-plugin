// 自定义协议：`zephyr://app/<路径>` → 产物目录里的文件。
//
// 归一化在这里做，是因为**它决定能不能被越界读到**：asar 里的产物目录之外的文件不该被这个协议碰到。
import { extname, join, normalize, sep } from "node:path";

/** 协议名。 */
export const SCHEME = "zephyr";

/** 响应用的 MIME（只列页面与资源真正会出现的几种）。 */
const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * 把一次请求的 URL 归一成产物目录里的绝对路径。
 * @param url - 请求 URL（可带 scheme）。
 * @param root - 产物根（静态面所在目录）。
 * @returns 文件绝对路径；越界即 `undefined`。
 */
export function resourcePathOf(url: string, root: string): string | undefined {
  const pathname = pathnameOf(url);
  const decoded = decodeURIComponent(pathname);
  // 先把前导的斜杠与 `../` 削掉，再用「落点是否还在产物根下」做二次校验：
  // URL 规范化（`../../` 在 scheme 之后会被浏览器语义折成 `/`）与编码过的点都走这条路径。
  const relative = normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/u, "");
  const target = join(root, relative === "" ? "index.html" : relative);
  return isInside(target, root) ? target : undefined;
}

/**
 * 从 URL 里取路径部分。
 * @param url - 请求 URL。
 * @returns 以 `/` 开头的路径。
 */
function pathnameOf(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(url)) return url.startsWith("/") ? url : `/${url}`;
  return new URL(url).pathname;
}

/**
 * 文件扩展名对应的 MIME。
 * @param file - 文件路径。
 * @returns MIME；未知扩展名给 `application/octet-stream`。
 */
export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 产物根下的一个相对路径是不是目录外的（测试与调用方都用它做二次校验）。
 * @param candidate - 绝对路径。
 * @param root - 产物根。
 * @returns 判断结果。
 */
export function isInside(candidate: string, root: string): boolean {
  const base = normalize(root).replace(/[/\\]+$/u, "");
  return candidate === base || candidate.startsWith(`${base}${sep}`);
}
