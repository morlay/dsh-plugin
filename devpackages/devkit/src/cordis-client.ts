import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { rolldown } from "rolldown";
import type { Plugin } from "rolldown";
import { cssInlinePlugins, resolveFileSpecifier } from "./css.ts";

// `__ModuleLoader__.load` 手递的三段：banner / intro / footer（构建与现场打包共用）。
const factoryBanner = (name: string): string =>
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`;
const FACTORY_INTRO = "var module = { exports: {} }; var exports = module.exports;";
const FACTORY_FOOTER = "return module.exports; } });";

export interface CordisClientOptions {
  // 插件 id（`__ModuleLoader__.load` 的 id 与样式 tag 前缀）
  name: string;
  // client 入口；默认 `./src/client/index.ts`
  entry?: string;
  // 追加 external（默认 react 系列 + `@deepseek-ai/*`）
  externals?: (string | RegExp)[];
  // 产出 client 半的类型声明（宿主 face 通过它引用 client 契约，不进源码）；默认开启
  dts?: boolean;
}

// 一份 client bundle 的解析与替换约定：tsdown 构建与开发态现场打包共用，避免两处规则漂移。
export interface ClientBundleSpec {
  externals: (string | RegExp)[];
  conditionNames: string[];
  // **浏览器产物专用**的替换约定（`process.env` / `import.meta` 替成空壳）：只许用在 client 半
  // （`bundleClientFactory`）。tsdown 的 define 对同一 config 的所有入口生效，塞进去会把 host 半
  // （Node / Electron 主进程）的 `process.env.DSH_*`、`import.meta.url` 一起抹掉。
  define: Record<string, string>;
}

// 解析与替换约定：追加 external、模块 id（dev 态现场打包用）与被构建包的目录；`cwd` 缺省 `process.cwd()`。
export async function clientBundleSpec(
  options: {
    externals?: (string | RegExp)[];
    mode?: string;
    // 被构建包的目录；缺省 `process.cwd()`（tsdown 在包目录跑，现场打包传被打包包的目录）。
    cwd?: string;
  } = {},
): Promise<ClientBundleSpec> {
  const mode = options.mode ?? process.env.NODE_ENV ?? "production";
  return {
    externals: [
      ...BASELINE,
      ...(await clientRowExternals(options.cwd)),
      ...(options.externals ?? []),
    ],
    conditionNames: [
      mode === "development" ? "development" : "production",
      "browser",
      "import",
      "module",
      "default",
    ],
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
      "import.meta.env.MODE": JSON.stringify(mode),
      "import.meta.env": JSON.stringify({ MODE: mode }),
      // CJS 输出下 rolldown 本来就把 `import.meta` 替换成 `{}`（`import.meta.url` 之类在浏览器产物里
      // 不可用）；显式声明同一语义，换掉 pdfjs 这类依赖的 EMPTY_IMPORT_META 警告。
      "import.meta": "({})",
      // 其余 `process.env.DSH_CLIENT_*`（源码按构建期常量读，例如 `ui-brand-official` 的
      // `process.env.DSH_CLIENT_BUILD_PROFILE !== 'official'`）：浏览器没有 `process`，不替换就是
      // 运行期 ReferenceError。上游由 `clientBuildEnvironmentDefines` 注入真实值；开发面这些名未设，
      // 按 undefined 处理与之一致。精确键（上面的 NODE_ENV）仍然优先。
      "process.env": "({})",
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[/\\^$*+?.()|[\]{}]/gu, "\\$&");
}

// 本包依赖里 client 行的 external 面（判据：该包清单有 `exports["./client"]`，与上游 host 半同一判据）：
// 漏判会让自己的 client 行落进内联分支，页面第二次注册即抛 `duplicate factory registration`。
// 例外是标了 `dsh.client.inline` 的包：它有同一个出口，但**不是行**——代码随消费方打进产物（模块表里没有它，
// 外置会 `missed the module table`），所以这里不纳入。每个 client 行返回一条 `^包名(?:/|$)` 正则；
// `cwd` 缺省 `process.cwd()`。
export async function clientRowExternals(cwd = process.cwd()): Promise<RegExp[]> {
  const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const names = [
    ...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]),
  ].sort();
  const require = createRequire(join(cwd, "package.json"));
  const rows: RegExp[] = [];
  for (const name of names) {
    let target: string;
    try {
      target = require.resolve(`${name}/package.json`);
    } catch {
      continue; // 装不上（可选依赖 / 测试面）——按内联处理，不猜。
    }
    const dependency = JSON.parse(await readFile(target, "utf8")) as {
      exports?: Record<string, unknown>;
      dsh?: { client?: { inline?: boolean } };
    };
    if (dependency.dsh?.client?.inline === true) continue;
    if (dependency.exports?.["./client"] === undefined) continue;
    rows.push(new RegExp(`^${escapeRegExp(name)}(?:/|$)`));
  }
  return rows;
}

// client 入口的 entry 名（同一个 tsdown config 里与 host 入口并存）。
export const CLIENT_ENTRY = "client";

// 声明产物后缀：由 tsdown 的 dts 直出，插件不碰。
const DECLARATION_SUFFIXES = [".d.ts", ".d.mts", ".d.cts"];

// 同一个 tsdown config 里的 client 入口处理：把 client 的**代码**换成自包含单文件（模块表的 `require`
// 只认包名，相对 chunk 引用会让工厂执行失败），只保留 client 的 CJS 与 host 的 ESM；client 的**声明**
// 仍由 tsdown 的 dts 直出。
export function clientEntryPlugin(options: {
  name: string;
  entry: string;
  externals?: (string | RegExp)[];
}): Plugin {
  return {
    name: "dsh-client-entry",
    async generateBundle(_outputOptions, bundle) {
      const clientChunks: string[] = [];
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== "chunk") continue;
        if (DECLARATION_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) continue;
        const isClient = item.name === CLIENT_ENTRY;
        const isClientFormat = fileName.endsWith(".cjs");
        if (isClient !== isClientFormat) {
          delete bundle[fileName];
          continue;
        }
        if (isClient) clientChunks.push(fileName);
      }
      const target = clientChunks[0];
      if (target === undefined) return;
      const chunk = bundle[target];
      if (chunk === undefined || chunk.type !== "chunk") return;
      const code = await bundleClientFactory({
        name: options.name,
        entry: options.entry,
        ...(options.externals === undefined ? {} : { externals: options.externals }),
      });
      chunk.code = code;
      // 自包含：断掉 tsdown 分块留下的相对引用（模块表解析不到它们）。
      chunk.imports = [];
      chunk.dynamicImports = [];
      chunk.moduleIds = [];
    },
  };
}

// 开发态现场打包：与 `defineCordisClientConfig` 同一份规则，产出注册脚本文本。
export interface ClientFactoryOptions {
  // 插件 id：必须与装配行解析到的包名一致（模块表的键）。
  name: string;
  // client 入口（绝对路径，或相对 `cwd`）。
  entry: string;
  // 追加 external，语义同 `CordisClientOptions.externals`。
  externals?: (string | RegExp)[];
  // 解析条件与 define 的模式；默认取 `NODE_ENV`（缺省 production，与发布构建一致）。
  mode?: string;
  // 打包工作目录（默认 `process.cwd()`）。
  cwd?: string;
}

// 现场把一份 client 半打成 `__ModuleLoader__.load` 注册脚本文本（不含 source map），供开发态直载；
// 打包未产出 chunk 时抛错。
export async function bundleClientFactory(options: ClientFactoryOptions): Promise<string> {
  const spec = await clientBundleSpec({
    ...(options.externals === undefined ? {} : { externals: options.externals }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  const build = await rolldown({
    input: options.entry,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    // client 半是**浏览器**产物（上游 `clientConfig` 同样是 `platform: 'browser'` + browser 条件）：
    // 用 node 平台会让第三方库走 node 条件导出，把 `crypto` 这类内置带进产物——浏览器 `require` 它
    // 必然在 boot 期抛错（`missed the module table`）。
    platform: "browser",
    resolve: { conditionNames: spec.conditionNames },
    transform: { define: spec.define },
    // 内置模块**不能** external：`platform: 'browser'` 下 rolldown 默认把 node 内置标成 external，
    // 浏览器 require 它们必然失败。显式放行 → 走 clientAssetPlugin 的替身。
    external: (id: string) => !NODE_BUILTIN.test(id) && isClientExternal(id, spec.externals),
    // 样式内联进字节：产物是自包含单文件，样式不能留在外部（见 cssInlinePlugins）。
    plugins: [...cssInlinePlugins({ name: options.name }), clientAssetPlugin()],
  });
  try {
    const { output } = await build.generate({
      format: "cjs",
      codeSplitting: false,
      entryFileNames: "client.js",
      banner: factoryBanner(options.name),
      footer: FACTORY_FOOTER,
      intro: FACTORY_INTRO,
    });
    const chunk = output.find((item) => item.type === "chunk");
    if (chunk === undefined || chunk.type !== "chunk")
      throw new Error(`devkit: bundleClientFactory(${options.name}) produced no chunk`);
    return chunk.code;
  } finally {
    await build.close();
  }
}

function isExternal(id: string, externals: (string | RegExp)[]): boolean {
  return externals.some((e) => (typeof e === "string" ? id === e : e.test(id)));
}

// 资产内联：现场打包的产物是自包含单文件，图片与字体不能留在外部——上游 client 产物同样是
// `data:<mime>;base64,…` 字符串（如 `ui-settings-account` 的 onboarding svg）。rolldown 默认把未知
// 扩展名当 JS 解析，所以必须显式 load，否则 client 源码里的 `import x from './x.svg'` 会变成 PARSE_ERROR。
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
  eot: "application/vnd.ms-fontobject",
};

// `?raw` 内联：源码把 worker 之类的内容当字符串内联（`import source from './worker.ts?raw'`）。
// query 必须在 `pre` 拿（默认顺序的钩子会先剥离它），所以走虚拟 id。
const RAW_PREFIX = "\0dsh-client-raw:";
const RAW_SUFFIX = ".mjs";

// node 内置的浏览器替身：第三方向浏览器产物里带 `require("util")` 这类调用时，模块表与平台种子词都答不上来，
// 整行会在 boot 期失败。上游对 `node:module` 是同一手法（`apps/web/src/node-module-stub.ts`）；这里统一成
// 一个空 CJS 模块——不执行到的分支无害，真执行到会抛（浏览器里本就没有这些能力）。
const NODE_BUILTIN_STUB = "\0dsh-node-builtin-stub.cjs";
const NODE_BUILTIN =
  /^(?:node:)?(?:assert|async_hooks|buffer|child_process|crypto|events|fs|http|https|module|net|os|path|process|stream|url|util|vm|worker_threads|zlib)$/;

// 资产与 `?raw` 内联插件：client 半（现场打包）与 web 前端（现场编译）两条链共用。
export function clientAssetPlugin(): Plugin {
  return {
    name: "dsh-client-asset",
    resolveId: {
      order: "pre",
      handler(source: string, importer: string | undefined) {
        if (NODE_BUILTIN.test(source)) return NODE_BUILTIN_STUB;
        if (!source.endsWith("?raw")) return null;
        return `${RAW_PREFIX}${resolveFileSpecifier(source.slice(0, -4), importer)}${RAW_SUFFIX}`;
      },
    },
    async load(id: string) {
      if (id === NODE_BUILTIN_STUB) return "module.exports = {};\n";
      if (id.startsWith(RAW_PREFIX)) {
        const file = id.slice(RAW_PREFIX.length, -RAW_SUFFIX.length);
        this.addWatchFile(file);
        return `export default ${JSON.stringify(await readFile(file, "utf8"))};`;
      }
      const file = id.split("?", 1)[0]!;
      if (file.startsWith("\0")) return;
      const mime = ASSET_MIME[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
      if (mime === undefined) return;
      const data = await readFile(file);
      return `export default "data:${mime};base64,${data.toString("base64")}";`;
    },
  };
}

// 平台 baseline：主应用种子或静态表提供的模块（React / cordis / 共享原语）。
const BASELINE: (string | RegExp)[] = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  /^@deepseek-ai\/cordis(\/|$)/,
  /^@deepseek-ai\/dsh-client-store(\/|$)/,
  /^@deepseek-ai\/dsh-client-ui-slots(\/|$)/,
  /^@deepseek-ai\/dsh-client-ui-primitives(\/|$)/,
  /^@deepseek-ai\/dsh-client-ui-dockkit(\/|$)/,
];

// 「契约层」：可安全内联的纯函数 / 线格式模块——没有需要跨插件共享的运行时身份（无单例、Symbol、
// instanceof 判定）；名单与上游 client 构建的 `INLINE_SAFE` 对齐（这些包没有模块表条目）。
export const INLINE_SAFE =
  /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-presets\/display$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-api-workspace-controller\/default-workspace$|@deepseek-ai\/dsh-spill-policy\/notice$|@deepseek-ai\/(?:cosmokit|schemastery)(?:\/|$))/;

// 判断一个模块是否留给平台/模块表（其余一律内联）。只信**显式列表**（baseline + 调用方给的行集）：
// 「所有 `@deepseek-ai/*` 都是 client 行」的兜底会把 `.../remote`、`/display` 这类子路径也送进模块表，
// 而模块表只按行条目注册——那些子路径在浏览器里 `require` 不到，整行会加载失败。
export function isClientExternal(id: string, externals: (string | RegExp)[]): boolean {
  if (!isExternal(id, externals)) return false;
  // 契约层内联：这些包没有模块表条目（即便名单里出现同名）。
  return !INLINE_SAFE.test(id);
}
