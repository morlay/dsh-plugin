/**
 * 壳的装配（**prebuild**）：把 `@morlay/dsh-desktop-shell` 装到打包工作目录里，成为 Electron 的 app 目录。
 *
 * 边界就到这里为止：**产物只落在 `<workspace>/.dshdev/shell/`**，源码树里的
 * `packages/desktop/dsh-desktop-shell/dist` 不再被 dev / bundle 依赖。
 *
 * **不能落在 `node_modules` 下**：Node 拒绝对那里的文件做类型剥离
 * （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），而壳的 `src/*.ts` 正是靠它 + loader 跑的。
 *
 * 装配内容（壳要什么给什么）：
 * - `bootstrap.mjs`：手写的启动引导（真 JS；Electron 的 app 目录必须有它，且它不参与构建）；
 * - `src/`：业务代码，由引导在运行期注册的 TS loader 直接跑；
 * - **`dist/preload-app.cjs`：唯一需要转译的一件**——Electron 要求 sandboxed preload 是 CJS（不能 ESM、
 *   不能 require 第三方），而它的源码是 TS，所以这里用 tsdown 单文件打一次（几十毫秒）；
 * - `package.json`（`main` 指引导）与 `locale/`。
 */
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

// 壳包根：源码树里那个包（装配的输入）。工具里不写死包名，一律由 node 解析。
export const SHELL_PACKAGE_ROOT = dirname(
  fileURLToPath(import.meta.resolve("@morlay/dsh-desktop-shell/package.json")),
);

/** 装配后的壳（Electron 的 app 目录）。 */
export interface AssembledShell {
  /** app 目录（`.dshdev/shell`）。 */
  readonly root: string;
  /** 入口（`main`）：手写的引导。 */
  readonly entry: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 装配壳（幂等：每次重来一遍，几十毫秒）。
 *
 * @param workspace - app 工作区目录（产物落在它下面的 `.dshdev/shell`）。
 * @returns 装配后的 app 目录与入口。
 */
export async function prepareShell(workspace: string): Promise<AssembledShell> {
  const root = join(workspace, ".dshdev", "shell");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  // 引导、业务源码、清单与本地化：直接拷（源码由引导的 loader 跑，不需要转译）。
  await cp(join(SHELL_PACKAGE_ROOT, "bootstrap.mjs"), join(root, "bootstrap.mjs"));
  await cp(join(SHELL_PACKAGE_ROOT, "src"), join(root, "src"), { recursive: true });
  if (await pathExists(join(SHELL_PACKAGE_ROOT, "locale"))) {
    await cp(join(SHELL_PACKAGE_ROOT, "locale"), join(root, "locale"), { recursive: true });
  }
  const manifest = JSON.parse(await readFile(join(SHELL_PACKAGE_ROOT, "package.json"), "utf8")) as {
    main?: string;
  };
  manifest.main = "./bootstrap.mjs";
  await writeFile(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // **唯一要转译的那一件**：sandboxed preload 必须是 CJS。
  await build({
    config: false,
    entry: { "preload-app": join(root, "src", "preload-app.ts") },
    outDir: join(root, "dist"),
    format: ["cjs"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: true,
    logLevel: "silent",
    // preload 只 require electron 自己的模块（sandboxed 约束），别把依赖内联进来。
    deps: { neverBundle: ["electron"] },
  });

  return { root, entry: join(root, "bootstrap.mjs") };
}
