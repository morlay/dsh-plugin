// 前端相关路由统一挂在 `/_zephyr/` 前缀下（HMR、联邦资源），与 gateway 的 `/api/…` 分开：
// 一个前缀一眼能看出「这是 zephyr 宿主自己提供的前端面」。
export const ZEPHYR_PREFIX = "/_zephyr";

/** HMR 的 WebSocket 路径。 */
export const HMR_PATH = `${ZEPHYR_PREFIX}/hmr`;

/** 联邦（client-modules）资源的 URL 前缀。 */
export const FEDERATION_PREFIX = `${ZEPHYR_PREFIX}/@modules`;

/**
 * vite 的 URL 空间前缀（`/@vite`、`/@fs`、`/@id`…）：对外一律加 `ZEPHYR_PREFIX`，
 * 入站由宿主 strip 回去再交给 vite——vite 的 `base` 不能改成 `/_zephyr/`（会给绝对 URL 再补一层）。
 */
export const VITE_URL_PREFIX = "/@";

/** vite 自己的那几个前缀：只有它们该被 strip 回去（`/_zephyr/@modules` 是我们的联邦资源，不能动）。 */
const VITE_NAMESPACES = ["@vite", "@fs", "@id", "@react-refresh"] as const;

/** 入站：`/_zephyr/@fs/…` → `/@fs/…`。 */
export function stripZephyrPrefix(url: string): string {
  for (const namespace of VITE_NAMESPACES) {
    const prefixed = `${ZEPHYR_PREFIX}/${namespace}`;
    if (url === prefixed || url.startsWith(`${prefixed}/`) || url.startsWith(`${prefixed}?`)) {
      return url.slice(ZEPHYR_PREFIX.length);
    }
  }
  return url;
}

/** 出站：正文里的 `"/@fs/…` 一律改成 `"/_zephyr/@fs/…`（HTML 与模块 body 同一口径）。 */
export function addZephyrPrefix(text: string): string {
  return text.replaceAll(`"${VITE_URL_PREFIX}`, `"${ZEPHYR_PREFIX}${VITE_URL_PREFIX}`);
}

/**
 * 响应的 body 分片：只改写以 `"/@` 开头的字符串字面量（vite 注入的模块/资源地址）。
 * 不含该片段的 Buffer 原样返回（保住引用，避免无谓拷贝）。
 */
export function rewriteUrls<T>(chunk: T): T {
  if (typeof chunk === "string") return addZephyrPrefix(chunk) as T;
  if (Buffer.isBuffer(chunk)) {
    const text = chunk.toString("utf8");
    return (text.includes(`"${VITE_URL_PREFIX}`) ? Buffer.from(addZephyrPrefix(text)) : chunk) as T;
  }
  return chunk;
}

/**
 * 把出站重写接到一个响应上：`write`/`end` 的正文分片都过 {@link rewriteUrls}。
 * 接线点必须在 gzip 包装**之内**（我们写明文，压缩由外层流负责）。
 */
export function attachUrlRewriting(res: {
  write: (...args: never[]) => unknown;
  end: (...args: never[]) => unknown;
}): void {
  const write = res.write.bind(res) as (chunk: never, ...rest: never[]) => unknown;
  res.write = ((chunk: never, ...rest: never[]) => write(rewriteUrls(chunk), ...rest)) as never;
  const end = res.end.bind(res) as (chunk?: never, ...rest: never[]) => unknown;
  res.end = ((chunk?: never, ...rest: never[]) => end(rewriteUrls(chunk), ...rest)) as never;
}
