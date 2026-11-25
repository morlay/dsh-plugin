// 客户端样式的编译能力（CSS Modules / 全局样式 / `?inline` / 资产内联策略）。
//
// home 在这里：**运行期**（client-modules 的 dev 逐文件直访与现场打包）与**构建期**（tsdown 插件
// 给各 cordis 客户端包打产物）共用同一份实现——两条链的 class 名与注入方式必须同形，所以不能各写一份。

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve as resolvePath } from "node:path";
import { bundleAsync, transform, type Visitor } from "lightningcss";
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

/**
 * 样式里 `url('./x.png')` 这类**文件引用**的处理：小图内联成 data URI，大图产出资产文件（发布链）。
 *
 * 用 lightningcss 的 `url()` 钩子而不是正则扫文本：`url()` 会出现在 `@supports` 内层、`mask` / `mask-image`
 * 简写、`image-set()`、`@font-face` 里，文本正则漏一处就是一张图凭空消失（`ui-chat` 的 running-whale 掩膜图
 * 就是这么丢的）。钩子是**同步**的，所以分两趟：**先收集**要处理的 url，异步读文件算好替换值，
 * 再跑一趟**只做替换**。
 *
 * @param css - 样式文本。
 * @param from - 样式文件路径（解析相对路径用）。
 * @param policy - 资产策略（`threshold` 时超过 {@link INLINE_LIMIT} 的走 `emit`）。
 * @param emit - 大图落文件时给出它的 URL。
 * @returns 处理后的样式文本。
 */
async function urlReplacements(
  css: string,
  from: string,
  policy: CssAssetPolicy = "threshold",
  emit?: (name: string, bytes: Uint8Array) => string,
): Promise<Map<string, string>> {
  // 先收集要处理的 url（跳过 data: / 外链 / 片段）。
  const specifiers = new Set<string>();
  transform({
    filename: from,
    code: Buffer.from(css),
    visitor: {
      Url(url) {
        const specifier = url.url;
        if (
          !specifier.startsWith("data:") &&
          !/^(?:https?:)?\/\//u.test(specifier) &&
          !specifier.startsWith("#")
        ) {
          specifiers.add(specifier);
        }
      },
    },
  });

  const replacements = new Map<string, string>();
  for (const specifier of specifiers) {
    const file = resolvePath(dirname(from), specifier);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch {
      // 找不到的文件保持原样：让浏览器按原路径报错，比静默吞掉更好定位。
      continue;
    }
    const extension = (file.split(".").pop() ?? "").toLowerCase();
    if (policy === "threshold" && bytes.byteLength >= INLINE_LIMIT && emit !== undefined) {
      // 大图产出资产文件（发布链），URL 指向它而不是塞 base64。
      replacements.set(specifier, emit(basename(file), bytes));
      continue;
    }
    const mime = CSS_ASSET_MIME[extension] ?? "application/octet-stream";
    replacements.set(specifier, `data:${mime};base64,${bytes.toString("base64")}`);
  }
  return replacements;
}

/** `url()` 的替换 visitor：**必须挂在最终那一趟 `transform` 上**（见 `compileCssModule` 的注释）。 */
function urlVisitor(replacements: ReadonlyMap<string, string>): Visitor<never> {
  return {
    Url(url) {
      const next = replacements.get(url.url);
      return next === undefined ? undefined : { ...url, url: next };
    },
  };
}

/**
 * 样式里 `url('./x.png')` 这类**文件引用**的处理：小图内联成 data URI，大图产出资产文件（发布链）。
 *
 * 用 lightningcss 的 `url()` 钩子而不是正则扫文本：`url()` 会出现在 `@supports` 内层、`mask` / `mask-image`
 * 简写、`image-set()`、`@font-face` 里，文本正则漏一处就是一张图凭空消失。钩子是**同步**的，所以分两趟；
 * 这条导出是"改文本"的形态（单测直接打它），编译函数则把替换合进它自己那一趟。
 *
 * @param css - 样式文本。
 * @param from - 样式文件路径（解析相对路径用）。
 * @param policy - 资产策略（`threshold` 时超过 {@link INLINE_LIMIT} 的走 `emit`）。
 * @param emit - 大图落文件时给出它的 URL。
 * @returns 处理后的样式文本。
 */
export async function rewriteCssUrls(
  css: string,
  from: string,
  policy: CssAssetPolicy = "threshold",
  emit?: (name: string, bytes: Uint8Array) => string,
): Promise<string> {
  const replacements = await urlReplacements(css, from, policy, emit);
  if (replacements.size === 0) return css;
  const { code } = transform({
    filename: from,
    code: Buffer.from(css),
    visitor: urlVisitor(replacements),
  });
  return code.toString();
}

/**
 * 把一份样式编译成**可直接下发的 ESM 模块**：执行时注入 `<style>`，`export default` 给 class 映射。
 *
 * 两条路径共用这一份实现：rolldown 插件（现场打包 / 发布）与 dev 的逐文件直访（按 URL 取 `.css`）。
 * 两者必须同形——同一份 CSS 在两种形态下的 class 名与注入方式要一致。
 */
export function compileStyleModule(options: {
  file: string;
  css: string;
  /** 注入的 style 归属（插件 id）：写进 `data-plugin` / `data-plugin-css`。 */
  name: string;
  classMap?: Readonly<Record<string, string>>;
}): string {
  const tagId = `${options.name}/${basename(options.file)}`;
  const source = [
    `const css = ${JSON.stringify(options.css)};`,
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
    options.classMap === undefined
      ? "export {};"
      : `export default ${JSON.stringify(options.classMap)};`,
  );
  return source.join("\n");
}

/**
 * 编译 CSS Modules：lightningcss 出 class 映射与文本（`[hash]_[local]` 与上游同形）。
 *
 * `url()` 的替换**挂在这一趟上**：lightningcss 自己也会重写 `url()`（把文件当它的资产、换成裸 hash，
 * 如 `url(VRAku6fjghkApIISiBWPzg)`），在它之前改文本会被它覆盖——那正是"掩膜图有资产、页面却不显示"。
 *
 * @param file - 样式文件路径。
 * @param source - 样式文本。
 * @param options - `minify`（发布链与上游同步开、日常关）、资产策略与 `emit`。
 * @returns 可直接下发的 ESM 模块源码。
 */
export async function compileCssModule(
  file: string,
  source: string,
  options: {
    minify?: boolean;
    assets?: CssAssetPolicy;
    emit?: (name: string, bytes: Uint8Array) => string;
  } = {},
): Promise<string> {
  const replacements = await urlReplacements(source, file, options.assets, options.emit);
  const { code, exports } = transform({
    filename: file,
    code: Buffer.from(source),
    cssModules: { pattern: "[hash]_[local]" },
    minify: options.minify ?? true,
    visitor: urlVisitor(replacements),
  });
  const classMap: Record<string, string> = {};
  for (const [local, entry] of Object.entries(exports ?? {})) classMap[local] = entry.name;
  return compileStyleModule({ file, css: code.toString(), name: PLUGIN_STYLE_NAME, classMap });
}

/** 编译全局样式（无 class 映射）：`url()` 与 `minify` 的取舍同 {@link compileCssModule}。 */
export async function compileGlobalCss(
  file: string,
  source: string,
  options: {
    minify?: boolean;
    assets?: CssAssetPolicy;
    emit?: (name: string, bytes: Uint8Array) => string;
  } = {},
): Promise<string> {
  const replacements = await urlReplacements(source, file, options.assets, options.emit);
  const { code } = transform({
    filename: file,
    code: Buffer.from(source),
    minify: options.minify ?? true,
    visitor: urlVisitor(replacements),
  });
  return compileStyleModule({ file, css: code.toString(), name: PLUGIN_STYLE_NAME });
}

// 逐文件直访时注入的 style 归属（打包形态下由插件 id 决定，dev 侧统一成这个）。
const PLUGIN_STYLE_NAME = "dev-client";

// 样式内联插件（CSS Modules / 全局 CSS / `?inline`）：`.module.css` 交 lightningcss 编译出 class
// 映射并在模块执行时注入样式，其余 `.css` 只注入，`.css?inline` 只导出编译后的文本。
// `options.name` 是插件 id（模块表键），写入注入 style tag 的 `data-plugin*` 属性；两条链共用这份实现。
/** 资产策略：`inline` 全部内联（dev——产物是自包含单文件，没有可放资产的位置）；`threshold` 按
 *  vite 的默认阈值（4KB）：小图内联、大图产出 `assets/` 文件（发布包不该被 base64 撑大）。 */
export type CssAssetPolicy = "inline" | "threshold";

/** 内联阈值（与 vite 的 `assetsInlineLimit` 同一个量级）：超过它就产出独立资产文件。 */
export const INLINE_LIMIT = 4096;

/** 跨包 `@import` 展开的深度上限：成环或链条过长时如实报错，而不是把构建拖死。 */
const MAX_CSS_IMPORT_DEPTH = 8;

/** 一个样式文件里的 `@import`：`bare` 是包引用（要展开），`relative` 是本包内的文件（继续跟）。 */
export interface CssImportSpecifiers {
  readonly bare: readonly string[];
  readonly relative: readonly string[];
}

/**
 * 一个样式文件里的 `@import` 说明符（**由闪电解析**，不扫文本）。
 *
 * 为什么要这份：枚举要沿样式继续走图（`@import "pkg/x.css"` 指向的包出口得进清单，相对引用得继续跟），
 * 而「哪些是 `@import`」只有解析器答得准（注释、字符串里的 `@import` 不算）。
 * @param css - 样式文本。
 * @param file - 来源文件（解析相对路径与报错定位用）。
 * @returns 裸说明符与相对说明符。
 */
export function cssImportSpecifiersOf(css: string, file: string): CssImportSpecifiers {
  const bare: string[] = [];
  const relative: string[] = [];
  transform({
    filename: file,
    code: Buffer.from(css),
    visitor: {
      Rule(rule) {
        if (rule.type !== "import") return undefined;
        const specifier = rule.value.url;
        if (specifier === undefined) return undefined;
        (specifier.startsWith(".") || specifier.startsWith("/") ? relative : bare).push(specifier);
        return undefined;
      },
    },
  });
  return { bare, relative };
}

/**
 * 样式文件 → **内联展开后的 CSS 文本**：`@import` 交给闪电（`bundleAsync`）按图展开——相对路径它按来源
 * 文件解析，跨包说明符交给 `resolveImport`（联邦链用它按包出口解析到那份副本的真实文件）。
 *
 * 每份文件的 `url()` 在**它自己的** `read` 那一趟改写（{@link rewriteCssUrls}）：内联进来的样式于是不会
 * 拿入口文件的目录当基准，资产策略（内联 / 产出 `assets/…`）也各按各的来源算。
 * @param options - 入口文件、跨包说明符的解析、资产策略与 `emit`。
 * @returns 可交给 `styleModule` 的 CSS 文本（`@import` 已展开）。
 * @throws Error `@import` 成环或展开过深（消息里带整条链）。
 */
export async function bundleCssFile(options: {
  readonly file: string;
  readonly importTargetOf: (specifier: string, from: string) => Promise<string | undefined>;
  readonly assets?: CssAssetPolicy;
  readonly emit?: (name: string, bytes: Uint8Array) => string;
}): Promise<string> {
  /** 展开图的父子边：环检测与深度都从这条链上读。 */
  const parents = new Map<string, string>();
  const chainOf = (file: string): string[] => {
    const chain = [file];
    for (let cursor = parents.get(file); cursor !== undefined; cursor = parents.get(cursor)) {
      chain.unshift(cursor);
    }
    return chain;
  };
  const result = await bundleAsync({
    filename: options.file,
    // 压缩交给外层那一趟（与 `cssModules` 同一趟），这里保持可读。
    minify: false,
    resolver: {
      async resolve(specifier, originatingFile) {
        // 相对 / 绝对：我们按来源文件解析（闪电把这两个也交过来）。
        if (specifier.startsWith(".")) return resolvePath(dirname(originatingFile), specifier);
        // 绝对路径与 `http(s)`：不是仓库里的文件，留成地址（浏览器自己去取）。
        if (specifier.startsWith("/") || /^https?:/u.test(specifier))
          return { external: specifier };
        const target = await options.importTargetOf(specifier, originatingFile);
        // 解析不到（不是这条链认识的包）：原样留着，浏览器如实报错比静默吞掉好定位。
        if (target === undefined) return { external: specifier };
        const chain = chainOf(originatingFile);
        if (chain.includes(target)) {
          throw new Error(`@import 成环：${[...chain, target].join(" → ")}`);
        }
        if (chain.length >= MAX_CSS_IMPORT_DEPTH) {
          throw new Error(
            `@import 展开过深（超过 ${String(MAX_CSS_IMPORT_DEPTH)} 层）：${[...chain, target].join(" → ")}`,
          );
        }
        parents.set(target, originatingFile);
        return target;
      },
      // 每份文件按**它自己**的目录处理 `url()`。
      async read(file) {
        return await rewriteCssUrls(
          await readFile(file, "utf8"),
          file,
          options.assets,
          options.emit,
        );
      },
    },
  });
  return result.code.toString();
}

export function cssInlinePlugins(options: {
  name: string;
  assets?: CssAssetPolicy;
  /** 压缩样式文本：**发布链与上游同步开**（上游 `tsdown.client.ts` 三处都是 `minify: true`），日常别开。 */
  minify?: boolean;
  /**
   * 资产文件名 → 它在**浏览器里**的地址。
   *
   * 缺省是文件名本身（`assets/x.png`，相对页面）；联邦链要的是绝对地址
   * （`/@client-modules/<pkg>@<ver>/assets/x.png`），由调用方给。
   */
  assetUrl?: (fileName: string) => string;
  /**
   * 样式里的**跨包说明符**（`@import "pkg/x.css"`）解析到那份副本的真实文件：展开（{@link bundleCssFile}）
   * 与「哪些出口要进清单」（{@link cssImportSpecifiersOf}）都靠它。
   *
   * 不给就是纯样式链（dev / tsdown 的产物自包含，`@import` 由闪电按相对路径处理）。
   */
  importTargetOf?: (specifier: string, from: string) => Promise<string | undefined>;
  /**
   * **跨包样式出口**的判据：真时这条 `.css` 说明符不进内联，而是标成外置（见 `dsh-css-global-inline`）。
   *
   * 由调用方给：外置名单是**联邦构建**的事实（它按每份副本的 `exports` 算出来），样式插件不认识它。
   * 判据落在这一处而不是每个调用方各写一遍，是为了让「内联」与「外置」永远二选一。
   */
  isFederatedStylesheet?: (specifier: string, importer: string | undefined) => boolean;
}): Plugin[] {
  // **资产占位**：`this.emitFile` 返回的是**引用 id**（rollup 的内部串，形如 `VRAku6fjghkApIISiBWPzg`），
  // 不是文件名——文件名要到 `generateBundle` 才拿得到。以前把这个 id 直接当 URL 写进 CSS，于是资产在盘上、
  // 清单里有、URL 却是个无意义标识（掩膜图就这么不显示）。现在先写占位，收尾统一换成真名。
  const pendingAssets = new Map<string, { name: string; bytes: Uint8Array }>();
  const placeholderFor = (name: string, bytes: Uint8Array): string => {
    const placeholder = `__DSH_ASSET_${String(pendingAssets.size)}__`;
    pendingAssets.set(placeholder, { name, bytes });
    return placeholder;
  };
  const emitAsset = (name: string, bytes: Uint8Array): string => placeholderFor(name, bytes);
  /**
   * 样式文本的**展开**：有跨包解析面就走闪电的 `bundleAsync`（`@import` 就地内联、每份文件的 `url()`
   * 按自己的目录归位），否则只做 `url()` 的资产改写。
   */
  const preparedCss = async (from: string): Promise<string> => {
    if (options.importTargetOf === undefined) {
      return await rewriteCssUrls(await readFile(from, "utf8"), from, options.assets, emitAsset);
    }
    return await bundleCssFile({
      file: from,
      importTargetOf: options.importTargetOf,
      ...(options.assets === undefined ? {} : { assets: options.assets }),
      emit: emitAsset,
    });
  };

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
      // **收尾**：这时 `emitFile` + `getFileName` 才拿得到真实文件名（`assets/x-<hash>.png`）。
      name: "dsh-css-assets",
      generateBundle(_options, bundle) {
        const urls = new Map<string, string>();
        for (const [placeholder, asset] of pendingAssets) {
          const reference = this.emitFile({
            type: "asset",
            name: asset.name,
            source: asset.bytes,
            originalFileName: asset.name,
          });
          const file = this.getFileName(reference);
          urls.set(placeholder, options.assetUrl === undefined ? file : options.assetUrl(file));
        }
        if (urls.size === 0) return;
        for (const item of Object.values(bundle)) {
          if (item.type !== "chunk") continue;
          let code = item.code;
          for (const [placeholder, url] of urls) code = code.replaceAll(placeholder, url);
          item.code = code;
        }
      },
    },
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
        const file = unwrap(virtualId, MODULES_PREFIX);
        // 虚拟 id 让真实样式文件落在 rolldown 的 watch 图之外，这里补回来。
        this.addWatchFile(file);
        // `url()` 的替换与跨包 `@import` 的展开都在这一步（每份文件按自己的目录解析）。
        const prepared = await preparedCss(file);
        const { code, exports } = transform({
          filename: file,
          code: Buffer.from(prepared),
          cssModules: { pattern: "[hash]_[local]" },
          minify: options.minify ?? true,
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
        const prepared = await preparedCss(file);
        const { code } = transform({
          filename: file,
          code: Buffer.from(prepared),
          minify: options.minify ?? true,
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
          // **跨包的样式出口不外置就内联二选一**：它自己就是一条产物（`…/brand-font.css.js`），
          // 内联进来会有两个后果——那份产物变成「盘上有、无人 import」的死产物，资产（字体/图片）
          // 也跟着各落一份；注入位次从「按 import 顺序」挪到「本产物末尾」，两条链的级联因此分叉
          // （同一条规则在 dev 排最前、在产物里排最后）。
          //
          // 这里**显式**声明外置，而不是 `return null` 交给内置的外置插件：那个插件（`esmExternalRequirePlugin`）
          // 是为 `require` 写的内置项，"静态 import 是否同样外置"没有契约可依；显式返回 `external: true`
          // 之后，地址由产物侧的 `paths` 按同一条规则（`productFileNameOf`）算，不会出现地址与产物不同形。
          if (options.isFederatedStylesheet?.(source, importer) === true) {
            return { id: source, external: true };
          }
          return GLOBAL_PREFIX + resolveFileSpecifier(source, importer) + VIRTUAL_SUFFIX;
        },
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(GLOBAL_PREFIX)) return null;
        const file = unwrap(virtualId, GLOBAL_PREFIX);
        this.addWatchFile(file);
        const prepared = await preparedCss(file);
        const { code } = transform({
          filename: file,
          code: Buffer.from(prepared),
          minify: options.minify ?? true,
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
