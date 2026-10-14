/**
 * 壳的装配（**prebuild**）：把 `@morlay/dsh-desktop-shell` 装到打包工作目录里，成为 Electron 的 app 目录。
 *
 * 边界就到这里为止：**产物只落在 `<workspace>/node_modules/.dshdev/shell/`**（打包工作目录，与 runtime /
 * seed 并列），源码树里的 `packages/desktop/dsh-desktop-shell/dist` 不再被 dev / bundle 依赖。
 *
 * 装配内容（壳要什么给什么）：
 * - `main.mjs`：**自动生成**的入口（真 JS；Electron 的 app 目录必须有它）。它只报包根、按包名加载
 *   业务入口——源码树里不需要一份手写的引导；
 * - `src/`：业务源码（拷过来）；`dist/`：转译后的入口与 preload（sandboxed preload 只能是 CJS，入口
 *   则因为打包形态的真实路径在 `node_modules` 下、随包的 loader 还接不住——见 `.agents/debts/`）；
 * - `package.json`（`main` 指引导）与 `locale/`。
 */
import { access, cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { isLocalPackage } from "@local/tsdown-plugin-cordis";

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

  // 解析面：装配目录**不在工作区里**，rolldown 从那里解析不到壳的依赖（`@morlay/dsh-desktop-host` 那些）
  // ——解析失败就无从内联，产物里会留下裸引用（打包后 `ERR_MODULE_NOT_FOUND`）。把壳包自己的解析面链过来。
  const modules = join(root, "node_modules");
  // 先显式清掉目标：上一轮装配失败时留下的链接不保证被上面的 `rm` 跟随，`symlink` 会 `EEXIST`。
  await rm(modules, { recursive: true, force: true });
  await symlink(join(SHELL_PACKAGE_ROOT, "node_modules"), modules, "junction");
  // 自引用：入口按**包名**加载自己（`import "@morlay/dsh-desktop-shell"`），走本目录清单的 `exports`。
  const selfLink = join(modules, "@morlay", "dsh-desktop-shell");
  await mkdir(dirname(selfLink), { recursive: true });
  await rm(selfLink, { recursive: true, force: true });
  await symlink(root, selfLink, "junction");
  // 业务源码与本地化：拷过来**不转译**（入口先挂 `ts-register`，Node 就能跑 `node_modules` 下的 `.ts`）。
  await cp(join(SHELL_PACKAGE_ROOT, "src"), join(root, "src"), { recursive: true });
  if (await pathExists(join(SHELL_PACKAGE_ROOT, "locale"))) {
    await cp(join(SHELL_PACKAGE_ROOT, "locale"), join(root, "locale"), { recursive: true });
  }
  // 业务入口：转译一遍（入口按包名走本目录清单的 `exports`，指到这里产出的 `dist`）。打包形态的真实
  // 路径就在 `node_modules` 下，而 Node 的内建类型剥离拒绝对那里动手——随包的 loader 目前还接不住，
  // 见 `.agents/debts/`。
  await build({
    config: false,
    entry: { index: join(root, "src", "index.ts") },
    outDir: join(root, "dist"),
    format: ["esm"],
    platform: "node",
    target: "esnext",
    dts: false,
    clean: true,
    deps: { neverBundle: ["electron"], alwaysBundle: (id) => isLocalPackage(id) },
  });

  // 唯一要转译的一件：**preload 必须是 CJS**（sandboxed preload 的约束，挂不了本仓库的 TS hooks）。
  await build({
    config: false,
    entry: { "preload-app": join(root, "src", "preload-app.ts") },
    outDir: join(root, "dist"),
    format: ["cjs"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: false,
    deps: { neverBundle: ["electron"], alwaysBundle: (id) => isLocalPackage(id) },
  });

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
        name: "@morlay/dsh-desktop-shell",
        version: source.version ?? "0.0.0",
        ...(source.description === undefined ? {} : { description: source.description }),
        ...(source.author === undefined ? {} : { author: source.author }),
        main: "./main.mjs",
        exports: { ".": "./dist/index.mjs", "./ts-register": "./src/ts-register.mjs" },
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );

  // 入口**自动生成**：Electron 的 app 目录必须有一个真 JS 入口，内容就三件事——报出包根、让 Node 能跑
  // `node_modules` 下的 `.ts`、按**包名**加载业务入口（走本目录清单的 `exports`）。
  const entry = join(root, "main.mjs");
  await writeFile(
    entry,
    [
      "// 由 `dshdev` 装配时生成（见 devpackages/dshdev/src/cli/shell.ts）：不手写、不参与仓库构建。",
      "globalThis.__DSH_SHELL_ROOT__ = import.meta.dirname;",
      "// 业务入口（走本目录清单的 `exports`）。",
      'await import("@morlay/dsh-desktop-shell");',
      "",
    ].join("\n"),
    "utf8",
  );
  return { root, entry };
}
