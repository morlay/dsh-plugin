import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve as resolvePath } from "node:path";
import { transform } from "lightningcss";
import type { Plugin } from "rolldown";

// 虚拟 id 与上游 client 构建（vendor 的 tsdown.client.ts）同前缀同后缀：两条链的语义一致，
// 产物里注入的 style tag 也按同一约定（`data-plugin-css="<id>/<文件名>"`）可识别。
const MODULES_PREFIX = "\0dsh-css-modules:";
const GLOBAL_PREFIX = "\0dsh-global-css:";
const INLINE_PREFIX = "\0dsh-inline-css:";
// 后缀必须不是 `.css`：tsdown 自带的样式管线按 id 后缀识别样式模块，虚拟模块不能被它接管。
const VIRTUAL_SUFFIX = ".mjs";
const INLINE_QUERY = "?inline";

// CSS 里 `url('./x.png')` 这类**文件引用**要内联成 data URI：现场打包的产物是自包含单文件，样式表里
// 留相对路径的话浏览器会按当前页面去请求、多半 404（`ui-chat` 的 running-whale 掩膜图就是这样丢的）。
// 上游 client 产物同样是内联形态（其它包直接在源码里写 data URI）。
const CSS_ASSET_MIME: Record<string, string> = {
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

async function inlineCssUrls(
  css: string,
  from: string,
  policy: CssAssetPolicy = "threshold",
  emit?: (name: string, bytes: Uint8Array) => string,
): Promise<string> {
  const matches = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gu)];
  let result = css;
  for (const match of matches) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    if (specifier.startsWith("data:") || /^(?:https?:)?\/\//u.test(specifier) || specifier.startsWith("#")) {
      continue;
    }
    const file = resolvePath(dirname(from), specifier);
    try {
      const bytes = await readFile(file);
      const extension = (file.split(".").pop() ?? "").toLowerCase();
      if (policy === "threshold" && bytes.byteLength >= INLINE_LIMIT && emit !== undefined) {
        // 大图产出资产文件（发布链），URL 指向它而不是塞 base64。
        result = result.replaceAll(match[0], `url("${emit(basename(file), bytes)}")`);
        continue;
      }
      const mime = CSS_ASSET_MIME[extension] ?? "application/octet-stream";
      result = result.replaceAll(match[0], `url("data:${mime};base64,${bytes.toString("base64")}")`);
    } catch {
      // 找不到的文件保持原样：让浏览器按原路径报错，比静默吞掉更好定位。
    }
  }
  return result;
}

// 样式内联插件（CSS Modules / 全局 CSS / `?inline`）：`.module.css` 交 lightningcss 编译出 class
// 映射并在模块执行时注入样式，其余 `.css` 只注入，`.css?inline` 只导出编译后的文本。
// `options.name` 是插件 id（模块表键），写入注入 style tag 的 `data-plugin*` 属性；两条链共用这份实现。
/** 资产策略：`inline` 全部内联（dev——产物是自包含单文件，没有可放资产的位置）；`threshold` 按
 *  vite 的默认阈值（4KB）：小图内联、大图产出 `assets/` 文件（发布包不该被 base64 撑大）。 */
export type CssAssetPolicy = "inline" | "threshold";

const INLINE_LIMIT = 4096;

export function cssInlinePlugins(options: { name: string; assets?: CssAssetPolicy }): Plugin[] {
  const styleModule = (
    file: string,
    css: string,
    classMap?: Readonly<Record<string, string>>,
  ): string => {
    const tagId = `${options.name}/${basename(file)}`;
    const source = [
      `const css = ${JSON.stringify(css)};`,
      `const tagId = ${JSON.stringify(tagId)};`,
      `if (typeof document !== "undefined" && document.querySelector(${JSON.stringify(
        `style[data-plugin-css="${tagId}"]`,
      )}) === null) {`,
      `  const tag = document.createElement("style");`,
      `  tag.dataset.plugin = ${JSON.stringify(options.name)};`,
      `  tag.dataset.pluginCss = tagId;`,
      `  tag.textContent = css;`,
      `  document.head.appendChild(tag);`,
      `}`,
    ];
    source.push(
      classMap === undefined ? "export {};" : `export default ${JSON.stringify(classMap)};`,
    );
    return source.join("\n");
  };

  return [
    {
      name: "dsh-css-modules-inline",
      resolveId: {
        // rolldown 在默认顺序的钩子之前剥离 import query、再把它拼回返回的 id；pre 才拿得到
        // 原始 specifier（上游 client 构建同理）。
        order: "pre",
        handler(source: string, importer: string | undefined) {
          if (!source.endsWith(".module.css")) return null;
          return MODULES_PREFIX + resolveFileSpecifier(source, importer) + VIRTUAL_SUFFIX;
        },
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(MODULES_PREFIX)) return null;
        const emitAsset = (assetName: string, bytes: Uint8Array): string =>
          this.emitFile({ type: "asset", name: assetName, source: bytes, originalFileName: assetName });
        const file = unwrap(virtualId, MODULES_PREFIX);
        // 虚拟 id 让真实样式文件落在 rolldown 的 watch 图之外，这里补回来。
        this.addWatchFile(file);
        const { code, exports } = transform({
          filename: file,
          code: Buffer.from(
            await inlineCssUrls(await readFile(file, "utf8"), file, options.assets, emitAsset),
          ),
          cssModules: { pattern: "[hash]_[local]" },
          minify: true,
        });
        const classMap: Record<string, string> = {};
        for (const [local, entry] of Object.entries(exports ?? {})) classMap[local] = entry.name;
        return styleModule(file, code.toString(), classMap);
      },
    },
    {
      name: "dsh-css-text-inline",
      resolveId: {
        order: "pre",
        handler(source: string, importer: string | undefined) {
          if (!source.endsWith(`.css${INLINE_QUERY}`)) return null;
          const stylesheet = source.slice(0, -INLINE_QUERY.length);
          return INLINE_PREFIX + resolveFileSpecifier(stylesheet, importer) + VIRTUAL_SUFFIX;
        },
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(INLINE_PREFIX)) return null;
        const file = unwrap(virtualId, INLINE_PREFIX);
        this.addWatchFile(file);
        const emitAsset = (assetName: string, bytes: Uint8Array): string =>
          this.emitFile({ type: "asset", name: assetName, source: bytes, originalFileName: assetName });
        const { code } = transform({
          filename: file,
          code: Buffer.from(
            await inlineCssUrls(await readFile(file, "utf8"), file, options.assets, emitAsset),
          ),
          minify: true,
        });
        return `export default ${JSON.stringify(code.toString())};`;
      },
    },
    {
      name: "dsh-css-global-inline",
      resolveId: {
        order: "pre",
        handler(source: string, importer: string | undefined) {
          if (!source.endsWith(".css")) return null;
          return GLOBAL_PREFIX + resolveFileSpecifier(source, importer) + VIRTUAL_SUFFIX;
        },
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(GLOBAL_PREFIX)) return null;
        const file = unwrap(virtualId, GLOBAL_PREFIX);
        this.addWatchFile(file);
        const emitAsset = (assetName: string, bytes: Uint8Array): string =>
          this.emitFile({ type: "asset", name: assetName, source: bytes, originalFileName: assetName });
        const { code } = transform({
          filename: file,
          code: Buffer.from(
            await inlineCssUrls(await readFile(file, "utf8"), file, options.assets, emitAsset),
          ),
          minify: true,
        });
        return styleModule(file, code.toString());
      },
    },
  ];
}

// 文件 specifier 的物理路径：相对 specifier 相对 importer 解析，裸包 specifier 按 importer 所在的包解析
// （例如 `@xterm/xterm/css/xterm.css`——直接拼路径会落到 importer 目录下，ENOENT），绝对 specifier 原样使用。
// 样式与资产（`?raw`）两类插件共用同一套解析。
export function resolveFileSpecifier(source: string, importer: string | undefined): string {
  const relative = source.startsWith(".") || source.startsWith("/");
  if (!relative && importer !== undefined) {
    return createRequire(importer).resolve(source);
  }
  return importer === undefined ? source : resolvePath(dirname(importer), source);
}

// 还原虚拟 id 里的物理路径。
function unwrap(virtualId: string, prefix: string): string {
  return virtualId.slice(prefix.length, -VIRTUAL_SUFFIX.length);
}
