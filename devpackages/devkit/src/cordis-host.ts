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

/**
 * 本地私有包前缀：`@local/*` 只活在本 workspace、从不发布。留在产物里消费方就会去
 * registry 找不存在的包，所以构建时一律内联进产物，发布清单里也不出现它们。
 */
export const LOCAL_PACKAGE_PREFIX = "@local/";

/** 依赖 id 是否属于本地私有包（含子路径）。 */
export function isLocalPackage(id: string): boolean {
  return id.startsWith(LOCAL_PACKAGE_PREFIX);
}

/**
 * 依赖 id 是否被 `inline` 选项点名（含子路径）：命中的包打进产物，`package.json` 里就不必声明它，
 * 消费方也不会因为一条 host 能力被拖上一个本来只为 client 半存在的包。
 */
export function isInlinedPackage(id: string, inline: readonly string[] | undefined): boolean {
  return inline?.some((name) => id === name || id.startsWith(`${name}/`)) ?? false;
}

/** `existsSync` 的异步等价物：任何 stat 失败都算条目不存在。 */
async function entryExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * cordis 插件包共享 tsdown 配置：host 与 client 是**同一次构建的两个入口**，
 * 因此 exports 与声明来自同一套产物视图（client 的差别由 {@link clientEntryPlugin}
 * 与按入口的 external 规则承担，不是第二个 config）。
 * entry 按约定探测（`src/index.ts`；`src/invariant.ts` 存在自动附带；
 * `src/client/index.ts` 存在自动附带 client 入口）。
 *
 * 异步：调用方把返回值直接作为 tsdown 配置的 default export 即可——
 * tsdown 的 `UserConfigExport` 本身接受 `Awaitable<UserConfig>`。
 */
export async function defineCordisPluginConfig(options?: {
  client?: CordisClientOptions | false;
  entries?: Record<string, string>;
  /**
   * 打进产物、不进 `package.json` 依赖清单的包（含子路径）。用于「复用某个包的代码，但不想把它变成
   * 运行期依赖」的情形：源码上仍是那一份（唯一 home），产物里内联一份。
   */
  inline?: readonly string[];
  /**
   * 无条件留在产物外的包（原生模块、自带二进制的构建器）：client 面的 external 由
   * {@link CordisClientOptions.externals} 管，这里管的是那些「谁 import 都不能打进来」的包。
   */
  neverBundle?: readonly string[];
  /** 产物目录，默认 `dist`。 */
  outDir?: string;
  /** 固定产物扩展名（`.mjs` / `.cjs`）；关闭时按 `package.json` 的 `type` 落 `.js`，默认开。 */
  fixedExtension?: boolean;
  /** 产出声明文件，默认开。 */
  dts?: boolean;
  /** 只构建、不导出的入口（产物要落位，但不该成为包的门面）。 */
  hidden?: readonly string[];
  /** 命令名 → 入口名：`bin` 两侧一起写（顶层指源码，发布态指产物）。 */
  bin?: Record<string, string>;
  /** 额外写 Node / Electron 的传统入口 `main` / `module`（理由见 {@link PackageExportsOptions}）。 */
  legacy?: boolean;
}): Promise<UserConfig> {
  const hasClientSource = await entryExists(join(process.cwd(), "src", "client", "index.ts"));
  const client =
    options?.client === false || (!hasClientSource && options?.client === undefined)
      ? undefined
      : (options?.client ?? { name: await packageName(), entry: "./src/client/index.ts" });

  const entry: Record<string, string> = { index: "./src/index.ts", ...options?.entries };
  if (await entryExists(join(process.cwd(), "src", "invariant.ts"))) {
    entry["invariant"] = "./src/invariant.ts";
  }
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
    // client 产物是 CJS（模块系统的工厂契约），host 产物是 ESM；没有 client
    // 入口的包只产 ESM。
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
    // 双模式库（如 lexical 的 exports 带 development / production / node 条件，
    // node 变体用 CJS 承载不了的 top-level await）必须解析到与下面 defines 一致
    // 的静态变体：条件名按 NODE_ENV 选 production / development，且不含 node。
    inputOptions: { resolve: { conditionNames: spec.conditionNames } },
    define: spec.define,
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
    plugins:
      client === undefined
        ? []
        : [
            clientEntryPlugin({
              name: client.name,
              entry: client.entry ?? "./src/client/index.ts",
              ...(client.externals === undefined ? {} : { externals: client.externals }),
            }),
            // client 入口的样式内联规则与现场打包共用一份实现：这里的产物虽被
            // clientEntryPlugin 换成现场打包的字节，但 tsdown 自己的这一次解析也必须
            // 认得样式 import，否则构建在 generateBundle 之前就断。
            ...cssInlinePlugins({ name: client.name }),
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
