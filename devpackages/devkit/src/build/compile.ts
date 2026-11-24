// 构建期入口：从包的 `exports` 推导入口，用 rolldown 打 ESM 产物（host 面），产物落 `dist/`。
// 不依赖 tsdown：声明由本文件的构建流程产出（全仓声明树一次 + 按包聚合），清单由 `writeBuildManifest` 写回。
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rolldown, type Plugin, type RolldownOptions } from "rolldown";
import { dtsRootOf, emitDts, ensureWorkspaceDts, repoRootOf } from "@local/dts-prepare";
import { bundleClientFactory } from "./cordis-client.ts";
import { cssInlinePlugins } from "./css.ts";

// 上游包的**源码子路径**（`@deepseek-ai/xxx/src/y.ts`）：npm 上这些包只发 `lib/*.js`，
// `./src/*` 出口是 TS 源码——运行期（Node 不允许 strip node_modules 下的 .ts）加载不了。
// 发布包一律不许引用它：能折回包名的折叠（cordis 根出口 `export *` 覆盖 `src/*` 的全部符号），
// 其余在构建期报错，逼源码改用该包的根出口或具名出口。
const UPSTREAM_SOURCE_SUBPATH = /^(@deepseek-ai\/[^/]+)\/src\/.*$/u;
const FOLDABLE_SOURCE_PACKAGES = new Set(["@deepseek-ai/cordis"]);

function upstreamSourceGuard(): Plugin {
  return {
    name: "devkit-upstream-source-guard",
    resolveId: {
      order: "pre",
      handler(source: string) {
        const matched = UPSTREAM_SOURCE_SUBPATH.exec(source);
        if (matched === null) return null;
        const name = matched[1] ?? "";
        // cordis 必须保持单例：折叠回包名（根出口 `export *` 覆盖 `src/*` 的符号）。
        if (FOLDABLE_SOURCE_PACKAGES.has(name)) return { id: name, external: true };
        // 其余源码子路径**内联**进产物：本仓有 vendor 源码，发布包自包含，不依赖上游只发布在
        // `./src/*` 里的 TS 源码（纯发布环境里加载不到）。
        return null;
      },
    },
  };
}

/**
 * 一个包的构建计划：入口名 → 源码路径（相对包目录）。
 */
export interface BuildPlan {
  readonly name: string;
  readonly entries: Record<string, string>;
  // 只构建、不进出口的入口名（命令行的 `bin` 目标：产物要落位，但不是包的门面）。
  readonly hidden: readonly string[];
  // 命令名 → 入口名：清单的 `bin` 两侧一起写（顶层指源码，发布态指产物）。
  readonly bin?: Record<string, string>;
  // 有 `dsh-bundle` 且有 `./ui` 的包：额外出一份 client（ESM 库 + CJS 工厂）。
  readonly client?: { readonly source: string };
  /** 含 `./dsh-bundle`：生成 `cordis.patch.yml` 并写 `dsh.bundle.patch`。 */
  readonly bundle?: boolean;
  /** bundle 的行声明源（`./src/dsh-bundle.ts`）。 */
  readonly bundleSource?: string;
}

const SKIP_EXPORTS = new Set(["./package.json", "./cordis.patch.yml"]);

/** 文件存在与否（bundle 包的约定文件判定）。 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 包目录里第一个存在的约定文件（相对包目录），都没有就是 undefined。
 * @param cwd - 包目录。
 * @param files - 候选（相对包目录）。
 * @returns `./<相对路径>`，或 undefined。
 */
async function firstExisting(cwd: string, files: readonly string[]): Promise<string | undefined> {
  for (const file of files) {
    try {
      await stat(join(cwd, file));
      return "./" + file;
    } catch {
      // 下一个候选。
    }
  }
  return undefined;
}

// 有产物形态的源码入口：样式、资产、JSON 这类出口不打包，随 `src` 一起发。
const MODULE_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;

// 本地私有包前缀：`@local/*` 只活在本 workspace、从不发布——构建时一律内联进产物。
export const LOCAL_PACKAGE_PREFIX = "@local/";

/** 依赖 id 是否属于本地私有包（含子路径）。 */
export function isLocalPackage(id: string): boolean {
  return id.startsWith(LOCAL_PACKAGE_PREFIX);
}

/** 依赖 id 是否被 `inline` 选项点名（含子路径）。 */
export function isInlinedPackage(id: string, inline: readonly string[] | undefined): boolean {
  return inline?.some((name) => id === name || id.startsWith(`${name}/`)) ?? false;
}

/**
 * 转译器**注入**进来的运行时 helper 包：rolldown 的 oxc 把 legacy 装饰器降级成
 * `@oxc-project/runtime/helpers/decorate` 这条 import，源码里一个字都没有。
 *
 * 它不是源码的依赖，所以发布包**不该**声明它——声明一份就得跟着 rolldown 的 oxc 版本线走，
 * 装到严格 `node_modules` 里还解析不到（我们的包一个都没装它）。这里排除在外置之外：
 * rolldown 把 helper 的内联源直接写进产物（产物里只剩一行 `function __decorate(…)`）。
 */
export const INJECTED_RUNTIME: readonly string[] = ["@oxc-project/runtime"];

/**
 * 推导入口：普通包从 `package.json` 的 `exports` 读（通配出口与没有产物形态的面——样式、资产——
 * 不在这里处理）；**bundle 包**（dsh 行入口）不看 `exports`，按固定文件取——包根是
 * `src/dsh-bundle.ts` 的产物，浏览器半是 `src/dsh-bundle.client.ts`（dsh 读字节的 CJS 工厂）。
 */
export async function planOf(cwd: string): Promise<BuildPlan> {
  const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
    name?: string;
    exports?: Record<string, unknown>;
    bin?: Record<string, unknown>;
  };
  // bundle 包按**固定文件**认：`src/dsh-bundle.ts` 存在就是 bundle 包。它的入口也按固定文件推导，
  // 不看 `exports`——那里面是空对象（发布态出口由构建写回 `publishConfig`，源码不被当库消费）。
  // 浏览器半同样是固定文件：`src/dsh-bundle.client.ts` 存在就出 CJS 工厂。
  const bundle = await exists(join(cwd, "src/dsh-bundle.ts"));
  const entries: Record<string, string> = {};
  const hidden: string[] = [];
  if (bundle) {
    entries["index"] = "./src/dsh-bundle.ts";
  } else {
    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
      if (typeof value !== "string" || !value.startsWith("./src/") || !MODULE_SOURCE.test(value)) {
        continue;
      }
      if (SKIP_EXPORTS.has(key) || key.includes("*")) continue;
      const name = key === "." ? "index" : key.slice(2);
      entries[name] = value;
    }
  }
  // 命令入口不进出口：按 `bin` 的源码文件名建入口，只构建、不写 `exports`。
  const bin: Record<string, string> = {};
  for (const [command, target] of Object.entries(manifest.bin ?? {})) {
    if (typeof target !== "string" || !target.startsWith("./src/") || !MODULE_SOURCE.test(target)) {
      continue;
    }
    const file = target.slice(target.lastIndexOf("/") + 1);
    const name = file.replace(MODULE_SOURCE, "");
    if (entries[name] !== undefined || name === "") continue;
    entries[name] = target;
    hidden.push(name);
    bin[command] = name;
  }
  // 浏览器半的固定文件：`src/dsh-bundle.client.ts`（同名三件套：name / inject / apply）。
  const clientSource = bundle
    ? await firstExisting(cwd, ["src/dsh-bundle.client.ts", "src/dsh-bundle.client.tsx"])
    : undefined;
  return {
    name: manifest.name ?? "package",
    entries,
    hidden,
    ...(Object.keys(bin).length === 0 ? {} : { bin }),
    ...(clientSource === undefined ? {} : { client: { source: clientSource } }),
    ...(bundle ? { bundle: true, bundleSource: "./src/dsh-bundle.ts" } : {}),
  };
}

function isBare(id: string): boolean {
  return !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0");
}

/** 一个入口的产物文件名（按入口名）。 */
export type BuildArtifacts = Record<string, readonly string[]>;

/**
 * host 面的 rolldown 选项：外置规则与解析条件只有这一份（构建与用例共用，避免两处漂移）。
 *
 * `cwd` 是 rolldown 找 tsconfig 的起点（legacy 装饰器的开关只写在 tsconfig 里）：
 * 构建时缺省 `process.cwd()`（从仓库根跑，就是根 `tsconfig.json`）。
 */
export function hostBuildOptions(options: {
  name: string;
  input: Record<string, string>;
  cwd?: string;
}): RolldownOptions {
  return {
    input: options.input,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    platform: "node",
    // 外置只放「源码里点名的裸依赖」：`@local/*` 与转译器注入的 helper 都进产物。
    // 上游源码子路径不在这里外置——交给 `upstreamSourceGuard` 折叠或报错（external 改不了说明符）。
    external: (id: string) =>
      isBare(id) &&
      UPSTREAM_SOURCE_SUBPATH.exec(id) === null &&
      !isLocalPackage(id) &&
      !isInlinedPackage(id, INJECTED_RUNTIME),
    resolve: { conditionNames: ["node", "import", "module", "default"] },
    plugins: [upstreamSourceGuard(), cssInlinePlugins({ name: options.name, assets: "inline" })],
  };
}

/** 用 rolldown 打一个包的 host 面；源码里点名的依赖外置、`@local/*` 与注入的 helper 内联。 */
export async function buildPackage(cwd: string, plan: BuildPlan): Promise<BuildArtifacts> {
  // 每次构建先清产物目录：多入口与共享 chunk 的文件名带 hash，旧文件不清会混进发布包。
  await rm(join(cwd, "dist"), { recursive: true, force: true });
  const input = Object.fromEntries(
    Object.entries(plan.entries).map(([name, source]) => [name, join(cwd, source)]),
  );
  const bundle = await rolldown(hostBuildOptions({ name: plan.name, input }));
  try {
    const { output } = await bundle.write({
      dir: join(cwd, "dist"),
      format: "esm",
      entryFileNames: "[name].mjs",
      chunkFileNames: "[name]-[hash].mjs",
      sourcemap: false,
    });
    const artifacts: Record<string, string[]> = {};
    for (const chunk of output) {
      if (chunk.type !== "chunk" || chunk.isEntry !== true) continue;
      artifacts[chunk.name] = [chunk.fileName];
    }
    // host 面声明：dts 是构建流程的一部分，不是构建的前置人工步骤。
    // 全仓声明树由 dts-prepare 的目录锁**跨进程只生成一次**（多包并行时第一个生成、其余等锁），
    // 再从树里按入口聚合到 dist（client 不出声明）。
    const root = await repoRootOf(cwd);
    await ensureWorkspaceDts(root);
    // bundle 包（dsh 行入口）不出声明：消费方是 dsh Loader，没有类型消费面。
    if (plan.bundle !== true) {
      await emitDts({ cwd, root, dtsRoot: dtsRootOf(root), entries: plan.entries, outDir: "dist" });
    }
    // bundle 且有 ui 的包：额外出 client 半——CJS 工厂给读字节的加载方。
    if (plan.client !== undefined) {
      const entry = join(cwd, plan.client.source);
      const factory = await bundleClientFactory({ name: plan.name, entry, cwd });
      await writeFile(join(cwd, "dist/client.cjs"), factory);
      artifacts["client"] = ["client.cjs"];
    }
    return artifacts;
  } finally {
    await bundle.close();
  }
}
