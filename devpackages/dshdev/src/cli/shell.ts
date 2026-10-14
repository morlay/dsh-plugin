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

  // 转译：**直接用壳自己的 tsdown 配置**（含 `SHELL_INLINE_PACKAGES` 那份内联规则与两遍构建：壳入口 ESM +
  // preload CJS）。配置里的 entry 相对**壳包目录**解析，所以临时切到那里跑，只把 `outDir` 指到装配目录——
  // 壳要什么由它自己的配置说了算，这里不重复一遍规则。
  const cwd = process.cwd();
  process.chdir(SHELL_PACKAGE_ROOT);
  try {
    await build({ config: join(SHELL_PACKAGE_ROOT, "tsdown.config.ts"), outDir: join(root, "dist") });
  } finally {
    process.chdir(cwd);
  }

  return { root, entry: join(root, "bootstrap.mjs") };
}
