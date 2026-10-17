import { readFile, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { TsdownHooks, TsdownPlugin, UserConfig } from "tsdown";
import {
  CLIENT_ENTRY,
  clientBundleSpec,
  clientEntryPlugin,
  isClientExternal,
  type CordisClientOptions,
} from "./cordis-client.ts";
import { cssInlinePlugins } from "./css.ts";
import { packageExportsHook, type PackageExportsOptions } from "./package-exports.ts";
import { dtsRootOf, emitDts, ensureWorkspaceDts, repoRootOf } from "@local/dts-prepare";

type BuildDoneHook = TsdownHooks["build:done"];

// 本地私有包前缀：`@local/*` 只活在本 workspace、从不发布——构建时一律内联进产物，发布清单里也不出现它们。
export const LOCAL_PACKAGE_PREFIX = "@local/";

// 依赖 id 是否属于本地私有包（含子路径）。
export function isLocalPackage(id: string): boolean {
  return id.startsWith(LOCAL_PACKAGE_PREFIX);
}

// 依赖 id 是否被 `inline` 选项点名（含子路径）：命中的包打进产物，`package.json` 里就不必声明它。
export function isInlinedPackage(id: string, inline: readonly string[] | undefined): boolean {
  return inline?.some((name) => id === name || id.startsWith(`${name}/`)) ?? false;
}

// `existsSync` 的异步等价物：任何 stat 失败都算条目不存在。
async function entryExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// `build:done` 的单一入口：先落该包的声明（从 `target/dts` 的全仓类型图按路径取、合并），再写回
// `package.json` 的出口清单。声明每包只产一次——多格式构建（esm / cjs）会多次进这个钩子。
const dtsRuns = new Set<string>();

function buildDone(
  options: PackageExportsOptions,
  outDir: string,
  declarationFiles: (entry: string) => readonly string[],
): BuildDoneHook {
  const exportsHook = packageExportsHook({ ...options, declarationFiles });
  return async (ctx) => {
    const cwd = process.cwd();
    if (!dtsRuns.has(cwd)) {
      dtsRuns.add(cwd);
      const root = await repoRootOf(cwd);
      await ensureWorkspaceDts(root);
      await emitDts({ cwd, root, dtsRoot: dtsRootOf(root), entries: options.entries, outDir });
    }
    await exportsHook(ctx);
  };
}

// cordis 插件包共享 tsdown 配置：host 与 client 是**同一次构建的两个入口**（client 的差别由
// `clientEntryPlugin` 与按入口的 external 规则承担，不是第二个 config）。
// entry 按约定探测：`src/index.ts`；`src/client/index.ts` 存在则自动附带。
export interface CordisPluginOptions {
  client?: CordisClientOptions | false;
  // 打进产物、不进 `package.json` 依赖清单的包（含子路径）：源码上仍是那一份，产物里内联一份。
  inline?: readonly string[];
  // 无条件留在产物外的包（原生模块、自带二进制的构建器）；client 面的 external 由 `CordisClientOptions.externals` 管。
  neverBundle?: readonly string[];
  // 产物目录，默认 `dist`。
  outDir?: string;
  // 固定产物扩展名（`.mjs` / `.cjs`）；关闭时按 `package.json` 的 `type` 落 `.js`，默认开。
  fixedExtension?: boolean;
  // 产出声明文件，默认开。
  dts?: boolean;
  // 只构建、不导出的入口（产物要落位，但不该成为包的门面）。
  hidden?: readonly string[];
  // 命令名 → 入口名：`bin` 两侧一起写（顶层指源码，发布态指产物）。
  bin?: Record<string, string>;
  // 额外写 Node / Electron 的传统入口 `main` / `module`（理由见 `PackageExportsOptions`）。
  legacy?: boolean;
}

/**
 * 本包在 tsdown 配置里声明的入口（`defineConfig({ entry })` 的归一形态）。
 *
 * **入口归 tsdown**：插件只消费它——额外入口、`client` 半的路径都由那里读，不再从插件选项传。
 *
 * @param entry - tsdown 的 `entry` 字段原值。
 * @returns 入口名 → 源码路径。
 */
function declaredEntries(entry: UserConfig["entry"]): Record<string, string> {
  if (entry === undefined || entry === null) return {};
  if (typeof entry === "string") return { index: entry };
  if (Array.isArray(entry)) {
    const fromArray: Record<string, string> = {};
    for (const file of entry) {
      if (typeof file === "string") fromArray[file.replace(/\W+/gu, "_")] = file;
    }
    return fromArray;
  }
  if (typeof entry !== "object") return {};
  const declared: Record<string, string> = {};
  for (const [name, value] of Object.entries(entry as Record<string, string | string[]>)) {
    const file = Array.isArray(value) ? value[0] : value;
    if (typeof file === "string") declared[name] = file;
  }
  return declared;
}

/**
 * 直接产出整份 tsdown 配置。
 *
 * 新代码写 `defineConfig({ entry, plugins: [cordisPlugin()] })`——入口归 tsdown，插件只消费。
 * 这个入口留给"一个包要产出多份配置"的组合场景（`dsh-desktop-shell`），它还得自己拼 `plugins` 数组。
 */
export async function buildCordisConfig(
  options: CordisPluginOptions | undefined,
  incoming: UserConfig = {},
): Promise<UserConfig> {
  const declared = declaredEntries(incoming.entry);
  const hasClientSource =
    declared[CLIENT_ENTRY] !== undefined ||
    (await entryExists(join(process.cwd(), "src", "client", "index.ts")));
  const client =
    options?.client === false || (!hasClientSource && options?.client === undefined)
      ? undefined
      : (options?.client ?? { name: await packageName(), entry: "./src/client/index.ts" });
  // 有 client 源码但没有「CJS 单文件工厂」形态（`client: false`）：产物是普通 ESM 库（内联库，消费方把它打进
  // 自己的 client 产物）。它没有工厂外壳，样式却照旧要内联——`dist/client.mjs` 里 import 的 `.module.css`
  // 不处理就是构建报错，处理了才是「模块执行即注入 style tag + 导出 class 映射」。
  const inlineLibrary = client === undefined && hasClientSource;

  // 入口：**以 tsdown 声明为准**；一个字都没写时按约定探测（`index` 是包的门面——工具类包没有它，
  // 例如只发 bin 的 CLI）。`client` 半由本插件按约定补上（它是 cordis 的约定，不是 tsdown 的）。
  const entry: Record<string, string> = declaredEntries(incoming.entry);
  // `index` 是包的**门面**：`src/index.ts` 在就一定有它，包名与 `./src/*` 之外的人只该从这里进。
  // 没声明时才补（声明了以声明为准）。
  if (entry["index"] === undefined && (await entryExists(join(process.cwd(), "src", "index.ts")))) {
    entry["index"] = "./src/index.ts";
  }
  if (client !== undefined) entry[CLIENT_ENTRY] = client.entry ?? "./src/client/index.ts";

  const spec = await clientBundleSpec(
    client?.externals === undefined ? {} : { externals: client.externals },
  );
  // **host 面一律外置**：host 产物跑在 Node 里，依赖由部署的 `node_modules` 提供——内联它们的字节既多余，
  // 又会让同一份包在部署里出现第二个实例（cordis 的服务类最怕这个）。内联只对 **client 面** 有意义
  // （浏览器没有 node_modules，模块表也只认自己那份身份），所以那边才按声明位置分流。
  //
  // 例外是"本仓库私有"与显式 `inline` 点名的包（见下面的 `alwaysBundle`）：它们不进部署的依赖面，
  // 只能随产物走。
  const clientRoot = `${sep}src${sep}${CLIENT_ENTRY}${sep}`;
  const fromClient = (importer: string | null | undefined): boolean =>
    typeof importer === "string" && importer.includes(clientRoot);

  return {
    name: client?.name ?? (await packageName()),
    entry,
    outDir: options?.outDir ?? "dist",
    // client 产物是 CJS（模块系统的工厂契约），host 产物是 ESM；没有 client 入口的包只产 ESM。
    format: client === undefined ? ["esm"] : ["esm", "cjs"],
    platform: "node",
    // 声明不归 tsdown：它给**每个包各建一次类型图**（实测单包 dts 4.8s、占该包构建 82%），而全仓一次
    // 只要几秒。声明在这里由 `emitDts` 从 `target/dts`（`just build` 的第一步生成）按路径取来合并。
    dts: false,
    fixedExtension: options?.fixedExtension ?? true,
    sourcemap: false,
    clean: true,
    // 清单由构建写回（`exports` 指源码、`publishConfig.exports` 指产物）：出口按入口推导，
    // client 半固定成 **库 + 工厂**两条条件（`import` 给 ESM 消费方、`default` 兜底给按包名读字节的
    // 加载方），手写的面（locale、cordis.patch.yml）在生成器里按文件存在性补。
    exports: false,
    hooks: {
      "build:done": buildDone(
        {
          entries: entry,
          ...(client === undefined ? {} : { clientEntry: CLIENT_ENTRY }),
          ...(options?.hidden === undefined ? {} : { hidden: options.hidden }),
          ...(options?.bin === undefined ? {} : { bin: options.bin }),
          ...(options?.legacy === undefined ? {} : { legacy: options.legacy }),
        },
        options?.outDir ?? "dist",
        (entry) =>
          entry === CLIENT_ENTRY ? [`${entry}.d.cts`, `${entry}.d.mts`] : [`${entry}.d.mts`],
      ),
    },
    // 双模式库（如 lexical 的 exports 带 development / production / node 条件）必须解析到与下面条件名
    // 一致的静态变体：条件名按 NODE_ENV 选 production / development，且不含 node。
    //
    // `transform.decorator.legacy: false` 是**发布线**的声明：dist 里的装饰器调用 registry 官方实现
    // （TC39 标准协议），而仓库 tsconfig 开着 `experimentalDecorators`（开发线用，见 devkit 的 tsconfig），
    // 不显式关掉 oxc 就会按 legacy 降级，产物与官方实现不兼容。
    inputOptions: {
      resolve: { conditionNames: spec.conditionNames },
      transform: { decorator: { legacy: false } },
    },
    // 这里**不写 `define`**：`spec.define` 是浏览器产物的替换约定（`process.env` / `import.meta` 替成空壳），
    // 而 tsdown 的 define 对同一个 config 里的所有入口生效——host 半（Node / Electron 主进程）拿到它就成了
    // `{}.DSH_HOME` / `({}).url` 这种运行期必炸的代码。client 半的字节最终由 `clientEntryPlugin` 换成
    // `bundleClientFactory` 的产物，那条链自己带 define（见 cordis-client.ts）。
    deps: {
      // external 只对 client 入口的模块图生效：host 半照常打自己的依赖闭包。
      neverBundle: (id: string, importer: string | null | undefined) =>
        (options?.neverBundle?.includes(id) ?? false) ||
        (fromClient(importer)
          ? isClientExternal(id, spec.externals)
          : // host 面外置的是**依赖**（裸包，部署的 `node_modules` 提供）。三类要内联：
            // · **源码**（相对 / 绝对 / 虚拟 id）——同一个包里的文件，外置就成了 `import "./x.ts"`；
            // · **本仓库私有**（`@local/*`）与**显式 `inline` 点名的包**——它们不进部署的依赖面，
            //   壳这类产物必须自包含（否则打包后去 asar 外找 `@morlay/dsh-desktop-host`，直接
            //   `ERR_MODULE_NOT_FOUND`）。
            !(isLocalPackage(id) || isInlinedPackage(id, options?.inline) || /^[./\0]/u.test(id))),
      alwaysBundle: (id: string, importer: string | null | undefined) =>
        isLocalPackage(id) ||
        isInlinedPackage(id, options?.inline) ||
        (fromClient(importer) && !isClientExternal(id, spec.externals)),
    },
    plugins: [
      ...(client === undefined
        ? []
        : [
            clientEntryPlugin({
              name: client.name,
              entry: client.entry ?? "./src/client/index.ts",
              ...(client.externals === undefined ? {} : { externals: client.externals }),
            }),
          ]),
      // 这里的产物会被 clientEntryPlugin 换成现场打包的字节，但 tsdown 这一次解析也必须认得样式 import；
      // 内联库（见上）没有工厂外壳，样式插件照旧要挂。
      ...(client === undefined && !inlineLibrary
        ? []
        : cssInlinePlugins({
            // 资产先全内联：`threshold` 那条要等发布链把 `assets/` 的命名与 URL 改写对齐
            // （emit 回来的文件名带 hash，CSS 里的相对 URL 得跟着它走），见债务「CSS 大图资产化」。
            name: client?.name ?? (await packageName()),
            assets: "inline",
          })),
    ],
  };
}

async function packageName(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
    name?: string;
  };
  if (!pkg.name) throw new Error("package.json 缺少 name");
  return pkg.name;
}

/**
 * cordis 插件包的 tsdown 插件：`defineConfig({ plugins: [cordisPlugin({ … })] })`。
 *
 * 它把"一个 cordis 插件包该怎么打"的所有约定收在一处——入口探测、host/client 两种产物形态、
 * client 入口的字节替换、样式与资产、依赖内外联规则、声明与出口清单的写回——各包只需声明
 * **自己的**那点差异（额外入口、client 的 id 与 external、bin…）。
 *
 * 实现走 tsdown 的 `tsdownConfig` 钩子（等价 Vite 的 `config` 钩子）：返回的 partial 会深合并进用户配置，
 * 数组字段（`plugins`）按替换处理——所以这里把自身的 rolldown 插件一并带上。
 *
 * @param options - 与 {@link defineCordisPluginConfig} 相同。
 * @returns tsdown 插件。
 */
export function cordisPlugin(options?: CordisPluginOptions): TsdownPlugin {
  return {
    name: "tsdown-plugin-cordis",
    async tsdownConfig(config) {
      return await buildCordisConfig(options, config);
    },
  };
}
