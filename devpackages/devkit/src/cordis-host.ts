import { readFile, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { UserConfig } from "tsdown";
import {
  CLIENT_ENTRY,
  clientBundleSpec,
  clientEntryPlugin,
  isClientExternal,
  type CordisClientOptions,
} from "./cordis-client.ts";
import { cssInlinePlugins } from "./css.ts";
import { packageExportsHook } from "./package-exports.ts";

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

// cordis 插件包共享 tsdown 配置：host 与 client 是**同一次构建的两个入口**（client 的差别由
// `clientEntryPlugin` 与按入口的 external 规则承担，不是第二个 config）。
// entry 按约定探测：`src/index.ts`；`src/client/index.ts` 存在则自动附带。
export async function defineCordisPluginConfig(options?: {
  client?: CordisClientOptions | false;
  entries?: Record<string, string>;
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
}): Promise<UserConfig> {
  const hasClientSource = await entryExists(join(process.cwd(), "src", "client", "index.ts"));
  const client =
    options?.client === false || (!hasClientSource && options?.client === undefined)
      ? undefined
      : (options?.client ?? { name: await packageName(), entry: "./src/client/index.ts" });
  // 有 client 源码但没有「CJS 单文件工厂」形态（`client: false`）：产物是普通 ESM 库（内联库，消费方把它打进
  // 自己的 client 产物）。它没有工厂外壳，样式却照旧要内联——`dist/client.mjs` 里 import 的 `.module.css`
  // 不处理就是构建报错，处理了才是「模块执行即注入 style tag + 导出 class 映射」。
  const inlineLibrary = client === undefined && hasClientSource;

  // 入口按存在性探测：`index` 是包的门面（工具类包没有它，例如只发 bin 的 CLI）。
  const entry: Record<string, string> = {};
  if (await entryExists(join(process.cwd(), "src", "index.ts"))) {
    entry["index"] = "./src/index.ts";
  }
  Object.assign(entry, options?.entries);
  if (client !== undefined) entry[CLIENT_ENTRY] = client.entry ?? "./src/client/index.ts";

  const spec = await clientBundleSpec(
    client?.externals === undefined ? {} : { externals: client.externals },
  );
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
    dts: options?.dts ?? true,
    fixedExtension: options?.fixedExtension ?? true,
    sourcemap: false,
    clean: true,
    // 清单由构建写回（`exports` 指源码、`publishConfig.exports` 指产物）：出口按入口推导，
    // client 半固定成 CJS 单文件形态，手写的面（locale、cordis.patch.yml）在生成器里按文件存在性补。
    exports: false,
    hooks: {
      "build:done": packageExportsHook({
        entries: entry,
        ...(client === undefined ? {} : { clientEntry: CLIENT_ENTRY }),
        ...(options?.hidden === undefined ? {} : { hidden: options.hidden }),
        ...(options?.bin === undefined ? {} : { bin: options.bin }),
        ...(options?.legacy === undefined ? {} : { legacy: options.legacy }),
      }),
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
        (fromClient(importer) && isClientExternal(id, spec.externals)),
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
        : cssInlinePlugins({ name: client?.name ?? (await packageName()) })),
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
