// 客户端产物的资产处理：扩展名 → mime、`?raw` 内联、资产按策略内联成 `data:` 或落成独立文件。
//
// home 在这里的理由同 `./styles.ts`：**运行期**（现场打包给浏览器）与**构建期**（tsdown 插件）共用一份，
// 否则两条链对"资产内联还是落文件"会各说各话。
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Plugin } from "rolldown";
import { INLINE_LIMIT, resolveFileSpecifier, type CssAssetPolicy } from "./styles.ts";

// 资产内联：现场打包的产物是自包含单文件，图片与字体不能留在外部——上游 client 产物同样是
// `data:<mime>;base64,…` 字符串（如 `ui-settings-account` 的 onboarding svg）。rolldown 默认把未知
// 扩展名当 JS 解析，所以必须显式 load，否则 client 源码里的 `import x from './x.svg'` 会变成 PARSE_ERROR。
/** 扩展名 → mime：资产内联（`data:`）与独立文件的响应头都用这一份。 */
export const ASSET_MIME: Record<string, string> = {
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
  eot: "application/vnd.ms-fontobject",
};

// `?raw` 内联：源码把 worker 之类的内容当字符串内联（`import source from './worker.ts?raw'`）。
// query 必须在 `pre` 拿（默认顺序的钩子会先剥离它），所以走虚拟 id。
const RAW_PREFIX = "\0dsh-client-raw:";
const RAW_SUFFIX = ".mjs";

// 资产（图片 / 字体）也走虚拟 id：**必须在 `pre` 抢下来**——vite 自己的资产插件在**库模式**下强制把
// 所有资产内联（产物要自包含），几 MB 的 PNG 会变成 base64 塞进 JS；而这份插件的策略（`assets`）要能说话。
const ASSET_PREFIX = "\0dsh-client-asset:";

// node 内置的浏览器替身：第三方向浏览器产物里带 `require("util")` 这类调用时，模块表与平台种子词都答不上来，
// 整行会在 boot 期失败。上游对 `node:module` 是同一手法（`apps/web/src/node-module-stub.ts`）；这里统一成
// 一个空 CJS 模块——不执行到的分支无害，真执行到会抛（浏览器里本就没有这些能力）。
const NODE_BUILTIN_STUB = "\0dsh-node-builtin-stub.cjs";
export const NODE_BUILTIN =
  /^(?:node:)?(?:assert|async_hooks|buffer|child_process|crypto|events|fs|http|https|module|net|os|path|process|stream|url|util|vm|worker_threads|zlib)$/;

// 资产与 `?raw` 内联插件：client 半（现场打包）与 web 前端（现场编译）两条链共用。
//
// `assets` 是**资产策略**（与样式侧同一个类型）：`inline`（默认）把所有资产写成 `data:` URL——现场打包的
// 产物是自包含单文件，没有放资产的位置；`threshold` 让**大**资产产出独立文件、模块里只留它的 URL
// （联邦预打包的产物是我们自己落盘、自己服务的，几 MB 的 base64 塞进 JS 只会让每个页面白背一遍）。
export function clientAssetPlugin(options: { assets?: CssAssetPolicy } = {}): Plugin {
  const policy = options.assets ?? "inline";
  return {
    name: "dsh-client-asset",
    resolveId: {
      order: "pre",
      handler(source: string, importer: string | undefined) {
        if (NODE_BUILTIN.test(source)) return NODE_BUILTIN_STUB;
        if (source.endsWith("?raw")) return `${RAW_PREFIX}${resolveFileSpecifier(source.slice(0, -4), importer)}${RAW_SUFFIX}`;
        const file = source.split("?", 1)[0] ?? "";
        if (mimeOf(file) !== undefined) return `${ASSET_PREFIX}${resolveFileSpecifier(file, importer)}`;
        return null;
      },
    },
    async load(id: string) {
      if (id === NODE_BUILTIN_STUB) return "module.exports = {};\n";
      if (id.startsWith(RAW_PREFIX)) {
        const file = id.slice(RAW_PREFIX.length, -RAW_SUFFIX.length);
        this.addWatchFile(file);
        return `export default ${JSON.stringify(await readFile(file, "utf8"))};`;
      }
      if (!id.startsWith(ASSET_PREFIX)) return;
      const file = id.slice(ASSET_PREFIX.length);
      this.addWatchFile(file);
      const mime = mimeOf(file) ?? "application/octet-stream";
      const data = await readFile(file);
      if (policy === "threshold" && data.byteLength >= INLINE_LIMIT) {
        // 大资产落成独立文件，模块里只留取它的 URL（`import.meta.ROLLUP_FILE_URL_*` 由 rolldown 替换成
        // 最终 URL，前缀跟着构建的 `base` 走——联邦链把它设成该包的地址前缀）。
        const referenceId = this.emitFile({
          type: "asset",
          name: basename(file),
          source: data,
          originalFileName: file,
        });
        return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
      }
      return `export default "data:${mime};base64,${data.toString("base64")}";`;
    },
  };
}

/** 路径 → 资产 mime（不在表里就不是资产，交给别的插件）。 */
function mimeOf(file: string): string | undefined {
  return ASSET_MIME[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
}
