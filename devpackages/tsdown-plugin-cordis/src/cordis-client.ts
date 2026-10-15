import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rolldown } from "rolldown";
import type { Plugin } from "rolldown";
import { clientAssetPlugin, NODE_BUILTIN } from "./assets.ts";
import { cssInlinePlugins } from "./css.ts";

// 资产那套（mime 表、`?raw`、资产内联/落文件）的 home 在 `@morlay/dsh-client-modules/src/assets.ts`——
// 运行期现场打包与这里的构建共用一份；下面只把名字转出来，外部 import 面不变。
export { ASSET_MIME, clientAssetPlugin } from "./assets.ts";

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

/**
 * 消费方清单里**要 external 的包**：`peerDependencies` 的那些。
 *
 * 判据就一条——**按声明位置分流**：`peerDependencies` 由宿主/运行时提供，client 产物里保留 import
 * （模块表有它的身份，内联反而会二次注册）；`dependencies` 的代码随产物内联（模块表里没有它们，
 * 外置必然 `missed the module table`）。
 *
 * 这套规则**只用于 CJS 产物**：那是模块表（`__ModuleLoader__.load` 工厂）的形态，谁内联谁外置有硬约束。
 * ESM 产物不做这套处理——它交给 vite / node 的 resolver。
 *
 * @param cwd - 消费方包目录，缺省 `process.cwd()`。
 * @returns 每条一个 `^包名(?:/|$)` 的正则。
 */
export async function clientRowExternals(cwd = process.cwd()): Promise<RegExp[]> {
  const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
    peerDependencies?: Record<string, string>;
  };
  return Object.keys(manifest.peerDependencies ?? {})
    .sort()
    .map((name) => new RegExp(`^${escapeRegExp(name)}(?:/|$)`));
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
      // 一个 client 入口出**两种**产物：CJS 是模块表的工厂形态（发布/桌面用），ESM 是普通库
      // （交给 vite / node resolver 消费）。tsdown 的 deps 规则按 format 区分不了，所以两边都由这里
      // 自己产出字节：CJS 走 `bundleClientFactory`（内联判定那套），ESM 走 `bundleClientLibrary`。
      let clientChunk: string | undefined;
      let libraryChunk: string | undefined;
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== "chunk") continue;
        if (DECLARATION_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) continue;
        if (item.name !== CLIENT_ENTRY) continue;
        if (fileName.endsWith(".cjs")) clientChunk = fileName;
        else libraryChunk = fileName;
      }
      const factory = clientChunk === undefined ? undefined : bundle[clientChunk];
      if (factory !== undefined && factory.type === "chunk") {
        factory.code = await bundleClientFactory({
          name: options.name,
          entry: options.entry,
          ...(options.externals === undefined ? {} : { externals: options.externals }),
        });
        // 自包含：断掉 tsdown 分块留下的相对引用（模块表解析不到它们）。
        factory.imports = [];
        factory.dynamicImports = [];
        factory.moduleIds = [];
      }
      const library = libraryChunk === undefined ? undefined : bundle[libraryChunk];
      if (library !== undefined && library.type === "chunk") {
        library.code = await bundleClientLibrary({ name: options.name, entry: options.entry });
      }
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
    // `treeshake` 显式开：两条线（现场打包与发布）共用这一支，产物都该只留用到的代码。
    treeshake: { moduleSideEffects: "no-external" },
    // 样式内联进字节：产物是自包含单文件，样式不能留在外部（见 cssInlinePlugins）。
    // 资产同样内联：单文件没有放资产的位置（发布线也是这一支，见债务「CSS 大图资产化」）。
    plugins: [...cssInlinePlugins({ name: options.name, assets: "inline" }), clientAssetPlugin()],
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

/**
 * 同一份 client 入口的 **ESM 库产物**。
 *
 * 与 {@link bundleClientFactory} 的差别只有一处：**裸说明符一律外置**，不做模块表那套内联/外置判定——
 * 模块表形态（CJS 工厂）对"谁内联谁外置"有硬约束，而 ESM 产物的依赖交给 vite / node 的 resolver。
 *
 * @param options - 插件 id 与 client 入口。
 * @returns 产物源码。
 */
export async function bundleClientLibrary(options: {
  name: string;
  entry: string;
  cwd?: string;
}): Promise<string> {
  const build = await rolldown({
    input: options.entry,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    platform: "browser",
    // 相对路径（含样式、资产、包内模块）照常处理；**裸说明符全部外置**。
    external: (id: string) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
    // 库产物保留导出面：消费方按名字取用，不能按"有没有被用到"摇掉。
    treeshake: false,
    // 样式与资产照旧内联成"模块执行即注入 + 导出 class 映射"：rolldown 不再支持把 CSS 当资源打包，
    // 不处理就是 `UNSUPPORTED_FEATURE: Bundling CSS is no longer supported`。
    plugins: [...cssInlinePlugins({ name: options.name, assets: "inline" }), clientAssetPlugin()],
  });
  try {
    const { output } = await build.generate({
      format: "es",
      codeSplitting: false,
      entryFileNames: "client.mjs",
    });
    const chunk = output.find((item) => item.type === "chunk");
    if (chunk === undefined || chunk.type !== "chunk")
      throw new Error(`devkit: bundleClientLibrary(${options.name}) produced no chunk`);
    return chunk.code;
  } finally {
    await build.close();
  }
}

function isExternal(id: string, externals: (string | RegExp)[]): boolean {
  return externals.some((e) => (typeof e === "string" ? id === e : e.test(id)));
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
