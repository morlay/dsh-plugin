/**
 * 壳的装配（**prebuild**）：把 `@morlay/dsh-desktop-shell` 装到打包工作目录里，成为 Electron 的 app 目录。
 *
 * 边界就到这里为止：**产物只落在 `<workspace>/node_modules/.dshdev/shell/`**（打包工作目录，与 runtime /
 * seed 并列），源码树里的 `packages/desktop/dsh-desktop-shell/dist` 不再被 dev / bundle 依赖。
 *
 * 装配内容（壳要什么给什么）：
 * - `bootstrap.mjs`：手写的启动引导（真 JS；Electron 的 app 目录必须有它，且它不参与构建）；
 * - `dist/`：**转译后的业务代码**——必须转译，`node_modules` 下的 `.ts` 跑不了（Node 的内建类型剥离对
 *   那里是硬限制，自定义 loader 拦不住），所以 prebuild 用 tsdown 打两遍（入口 ESM + preload CJS）；
 * - `package.json`（`main` 指引导）与 `locale/`。
 */
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { isInlinedPackage, isLocalPackage } from "@local/tsdown-plugin-cordis";
import { SHELL_INLINE_PACKAGES } from "@morlay/dsh-desktop-shell/inline-packages";

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
 * @param workRoot - 打包工作目录（调用方给的就是 `node_modules/.dshdev`）。
 * @returns 装配后的 app 目录与入口。
 */
export async function prepareShell(workRoot: string): Promise<AssembledShell> {
  const root = join(workRoot, "shell");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  // 引导、业务源码、清单与本地化：直接拷（源码由引导的 loader 跑，不需要转译）。
  await cp(join(SHELL_PACKAGE_ROOT, "bootstrap.mjs"), join(root, "bootstrap.mjs"));
  await cp(join(SHELL_PACKAGE_ROOT, "src"), join(root, "src"), { recursive: true });
  if (await pathExists(join(SHELL_PACKAGE_ROOT, "locale"))) {
    await cp(join(SHELL_PACKAGE_ROOT, "locale"), join(root, "locale"), { recursive: true });
  }
  // 装配清单：Electron 只读 `name` / `version` / `main`（`main` 指引导）。**不要带 dependencies**——
  // 那些是壳的实现依赖（electron / loader），运行期由 Electron 与引导负责，而 electron-builder 会因为
  // app 目录里出现 `electron` 依赖直接拒绝打包。
  const source = JSON.parse(await readFile(join(SHELL_PACKAGE_ROOT, "package.json"), "utf8")) as {
    version?: string;
    description?: string;
    author?: string;
  };
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "dsh-desktop-shell",
        version: source.version ?? "0.0.0",
        ...(source.description === undefined ? {} : { description: source.description }),
        ...(source.author === undefined ? {} : { author: source.author }),
        main: "./bootstrap.mjs",
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );

  // 转译两遍。判据与名单**复用壳那一份**（`SHELL_INLINE_PACKAGES` 与 `isInlinedPackage` / `isLocalPackage`）：
  // 壳跑在 app 目录里，`@morlay/*` 这类进不了解析面的包必须内联，否则打包后就是 ERR_MODULE_NOT_FOUND。
  // 不走壳的 tsdown 配置本身：那是仓库构建的入口（两段各有自己的 `outDir` 与声明校验），而这里要的是
  // "把同一套外置规则用在这个目录上"。
  const bundle = (id: string): boolean =>
    isInlinedPackage(id, SHELL_INLINE_PACKAGES) || isLocalPackage(id);
  await build({
    config: false,
    entry: { index: join(root, "src", "index.ts") },
    outDir: join(root, "dist"),
    format: ["esm"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: true,
    deps: { neverBundle: ["electron"], alwaysBundle: bundle },
  });
  // preload 必须是 CJS（sandboxed preload 的约束），单独一遍；`clean: false` 保住上一遍的产物。
  await build({
    config: false,
    entry: { "preload-app": join(root, "src", "preload-app.ts") },
    outDir: join(root, "dist"),
    format: ["cjs"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: false,
    deps: { neverBundle: ["electron"], alwaysBundle: bundle },
  });

  return { root, entry: join(root, "bootstrap.mjs") };
}
