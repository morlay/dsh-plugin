/**
 * 壳的装配（**prebuild**）：把 `@morlay/dsh-desktop-shell` 装到打包工作目录里，成为 Electron 的 app 目录。
 *
 * 边界就到这里为止：**产物只落在 `<workspace>/node_modules/.dshdev/shell/`**（打包工作目录，与 runtime /
 * seed 并列），源码树里的 `packages/desktop/dsh-desktop-shell/dist` 不再被 dev / bundle 依赖。
 *
 * 装配内容（壳要什么给什么）：
 * - `main.mjs`：**自动生成**的入口（真 JS；Electron 的 app 目录必须有它）。它只报包根、按包名加载
 *   业务入口——源码树里不需要一份手写的引导；
 * - **整包的源码**（`src/`、清单、本地化）——入口由 `main.mjs` 按包名加载，走清单的 `exports`；
 * - **不再产 `dist/`**：preload 的 CJS 由宿主机现场打包（见 `@morlay/dsh-desktop-host/preload-source`），
 *   壳在窗口创建前取走；
 * - `package.json`（`main` 指引导）与 `locale/`。
 */
import { access, cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  // **整包拷**（包作为整体）：清单原样带着（`main` 与 `exports` 都由壳包自己声明，装配不改写它）。
  await cp(join(SHELL_PACKAGE_ROOT, "package.json"), join(root, "package.json"));
  // 业务源码与本地化：拷过来**不转译**（入口先挂 `ts-register`，Node 就能跑 `node_modules` 下的 `.ts`）。
  await cp(join(SHELL_PACKAGE_ROOT, "src"), join(root, "src"), { recursive: true });
  if (await pathExists(join(SHELL_PACKAGE_ROOT, "locale"))) {
    await cp(join(SHELL_PACKAGE_ROOT, "locale"), join(root, "locale"), { recursive: true });
  }
  // 入口**自动生成**：Electron 的 app 目录必须有一个真 JS 入口，内容就三件事——报出包根、让 Node 能跑
  // `node_modules` 下的 `.ts`、按**包名**加载业务入口（走本目录清单的 `exports`）。
  const entry = join(root, "main.mjs");
  await writeFile(
    entry,
    [
      "// 由 `dshdev` 装配时生成（见 devpackages/dshdev/src/cli/shell.ts）：不手写、不参与仓库构建。",
      "globalThis.__DSH_SHELL_ROOT__ = import.meta.dirname;",
      "",
      "// Electron 打包后不把主进程的 stderr 送出去，这里兜一层：入口失败时至少留下原因。",
      "try {",
      "  // 先让 Node（含 Electron 的主进程）能跑 `node_modules` 下的 `.ts`：这条链的源码都是 TS，而",
      "  // Node 内建的类型剥离拒绝对那里动手。那份注册钩子在**随包 runtime** 里（`../runtime/loader/`，",
      "  // dev 由 dshdev 备、打包由 prepareRuntime 备）——app 目录里没有 `node_modules`。",
      '  await import(new URL("../runtime/loader/ts-register.mjs", import.meta.url).href);',
      "  // 业务入口：按**包名**加载，走壳包清单的 `exports`（指向 `src/index.ts`）。",
      '  await import("@morlay/dsh-desktop-shell");',
      "} catch (error) {",
      '  console.error("[dsh-shell] 入口失败:", error);',
      "  throw error;",
      "}",
      "",
      "",
    ].join("\n"),
    "utf8",
  );
  return { root, entry };
}
