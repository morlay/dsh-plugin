// 打包动作的接缝：**配置推导**留在纯函数里，**真正调用 electron-builder** 放在这里。
//
// app 目录怎么来：**用 `pnpm --filter @morlay/zephyr-desktop-shell deploy` 装**（壳的依赖图完整、lock
// 一致，electron-builder 才会按图收集进 asar）。手拷进去的包它不认——那是之前 `oxc-transform`
// 静默消失的原因。
//
//   <app>/
//   ├── dist/            壳的产物（deploy 自带，壳的 `files` 里有 `dist`）
//   ├── node_modules/    壳的依赖（含 `@morlay/dsh-oxc-node` → `oxc-transform`）
//   ├── bootstrap.mjs    打包形态的启动器（部署值 → 壳，见 `desktop-dirs.ts`）
//   └── package.json     入口改写为 `./bootstrap.mjs`
//
// 宿主的那一份（`build` 的 `<outputDir>`：`bootstrap.mjs` / `client_modules/` / `src/` / 闭包 /
// `package.json`）在打包之后整份复制进 `Resources/runtime`——它是自包含的一份应用，壳在那里 `chdir`。
import {
  access,
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { appPackageNameOf, CliError } from "@morlay/zephyr-cli";
import { packagedBootstrap } from "./desktop-dirs.ts";
import type { ElectronBuilderConfig } from "./electron-builder.ts";
import { assertRuntimeSmoke, resourcesDirOf } from "./runtime-smoke.ts";

const run = promisify(execFile);

/** 壳的包名（`dist/` 从这里取）。 */
const SHELL_PACKAGE = "@morlay/zephyr-desktop-shell";

/** 打包形态的启动器文件名（app 目录里，`main` 指它）。 */
const BOOTSTRAP_FILE = "bootstrap.mjs";

/** 一次打包的结果。 */
export interface PackResult {
  /** 产出的应用目录（`.zephyr/app/<平台>-<架构>/<产品名>.app` 之类）。 */
  readonly appDir: string;
}

/** 打包所需的输入。 */
export interface PackInput {
  /** app 目录（electron-builder 的 projectDir）。 */
  readonly appDir: string;
  /** 宿主的那一份（`build` 的 `<outputDir>`：`bootstrap.mjs` + `client_modules/` + 闭包 + 源码面入口）。 */
  readonly profileDir: string;
  /** workspace 根：闭包**直接 deploy 到 `Resources/runtime`**（不再复制那 900MB）。 */
  readonly workspace: string;
  /** 步骤日志文件（每步一行，含耗时）：卡住时从这里看最后一条。 */
  readonly logFile: string;
}

/** 打包契约。 */
@Injectable()
export abstract class Packager {
  /**
   * 打一个当前平台的应用目录。
   * @param config - electron-builder 配置。
   * @param input - app 目录、宿主闭包与日志文件。
   * @returns 产物位置。
   */
  abstract pack(config: ElectronBuilderConfig, input: PackInput): Promise<PackResult>;

  /**
   * 把产物装进系统应用目录。
   * @param result - 打包结果。
   * @returns 装到哪。
   */
  abstract install(result: PackResult): Promise<string>;
}

/** 默认实现：deploy 壳 → 叠宿主闭包 → electron-builder。 */
@Injectable()
export class PackagerDefault extends Packager {
  private readonly logger = inject(Logger);

  /**
   * @param config - electron-builder 配置。
   * @param input - app 目录、宿主闭包与日志文件。
   * @returns 产物位置。
   */
  async pack(config: ElectronBuilderConfig, input: PackInput): Promise<PackResult> {
    await this.assemble(input);
    const module = (await import("electron-builder").catch(() => undefined)) as
      | { build?: (options: { config: unknown; dir: boolean }) => Promise<readonly string[]> }
      | undefined;
    if (module?.build === undefined) {
      throw new CliError("没有装 electron-builder：desktop bundle 需要它（peerDependency）。");
    }
    process.chdir(input.appDir);
    const outputs = await this.step(
      input.logFile,
      `electron-builder 归档（asar）→ ${config.directories.output}`,
      () => module.build?.({ config, dir: true }) ?? Promise.resolve([]),
    );
    const appDir = outputs[0] ?? (await discoverAppDir(config.directories.output));
    const runtimeDir = join(await resourcesDirOf(appDir), "runtime");
    await this.step(input.logFile, `装宿主产物 → ${runtimeDir}`, () =>
      copyRuntime(input, runtimeDir),
    );
    // 装完先证明它自包含：不自包含的包装出来是「双击没反应」。
    await this.step(input.logFile, "打包期冒烟：闭包自包含 + 入口能被 loader 加载", async () => {
      await this.note(input.logFile, `[bundle] 冒烟对象：${runtimeDir}`);
      const report = await assertRuntimeSmoke(runtimeDir);
      const escaping = report.links.filter((link) => !link.inside).length;
      await this.note(
        input.logFile,
        `[bundle] 闭包链接：${String(report.links.length)} 个，逃逸 ${String(escaping)} 个`,
      );
      return runtimeDir;
    });
    return { appDir };
  }

  /**
   * 备 app 目录：deploy 壳（依赖合法进 asar）→ 宿主闭包放 `profile/` → 改入口。
   * @param input - app 目录与宿主闭包。
   */
  private async assemble(input: PackInput): Promise<void> {
    await this.step(input.logFile, `清空 app 目录（${input.appDir}）`, async () => {
      await rm(input.appDir, { recursive: true, force: true });
      await mkdir(input.appDir, { recursive: true });
    });
    await this.step(input.logFile, `重建壳包（${SHELL_PACKAGE} 的 dist）`, async () => {
      // 壳的 `dist/` 是 deploy 从**壳包自己的 `files`** 里带出来的：源码改了却没 build，打出来的包里
      // 还是旧壳（症状：新加的启动路径不生效，日志里仍是上一条链的报错）。与 `bundle` 无条件先建应用
      // 产物同一个理由——包必须与源码一致；这一步只要几秒。
      await run("pnpm", ["--filter", SHELL_PACKAGE, "run", "build"], {
        cwd: await workspaceRootOf(),
      });
    });
    await this.step(
      input.logFile,
      `pnpm --filter ${SHELL_PACKAGE} deploy → ${input.appDir}`,
      async () => {
        // **按应用的依赖 deploy**：闭包里既有宿主需要的包，也含壳额外要的（`@morlay/zephyr`、
        // `@morlay/dsh-oxc-node` 已写进应用的 dependencies）。这样 app 目录里的 `node_modules` 就是
        // 「外面那份工作区」在 asar 内的等价物——宿主与壳都按同一套解析规则找到包。
        // 壳的 app 目录：只装**壳**的依赖（`dist/` 由壳包自己的 `files` 带出来）。宿主闭包在
        // `Resources/runtime`（由配置的 `afterPack` 放），两边各管各的依赖图，不合并。
        await run(
          "pnpm",
          ["--filter", SHELL_PACKAGE, "deploy", "--prod", "--ignore-scripts", input.appDir],
          { cwd: await workspaceRootOf() },
        );
      },
    );
    await this.step(input.logFile, "让 electron-builder 的包遍历在 app 目录停下", async () => {
      // 不写这个，electron-builder 会向上找到工作区、跑一遍 pnpm 收集（几十秒到几分钟，还可能改包）。
      await writeFile(join(input.appDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
    });

    await this.step(input.logFile, "写打包形态的启动器（部署值 → 壳）并改入口", async () => {
      // 启动器是第一跳：Finder 启动没有环境变量，而 `userData` 只能在 ready 之前 `setPath`。
      // 算法只有 `desktop-dirs.ts` 一处（壳不自己拼 appData），这里只把源码落到 app 目录。
      await writeFile(join(input.appDir, BOOTSTRAP_FILE), packagedBootstrap(), "utf8");
      const manifestPath = join(input.appDir, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        main?: string;
        dependencies?: Record<string, string>;
      };
      // deploy 会把壳的 peer `electron` 装成 dependency，electron-builder 只允许它在 devDependencies。
      // 只改清单：`node_modules/electron` 还要留着给它算版本。
      if (manifest.dependencies?.electron !== undefined) delete manifest.dependencies.electron;
      // **必须连包一起删**：`pnpm deploy` 把壳的 peer `electron` 装进了 `node_modules`，打包后
      // `require("electron")` 会解析到那个 **npm 包**（导出的是可执行文件路径字符串），
      // `electron.app` 于是是 `undefined`（症状：启动即崩 `Cannot read properties of undefined (reading 'setPath')`）。
      // 版本已由 `electronVersion` 显式给出，不依赖它算。
      await rm(join(input.appDir, "node_modules", "electron"), { recursive: true, force: true });
      manifest.main = `./${BOOTSTRAP_FILE}`;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    });
  }

  /**
   * 跑一步并记日志（**同时写文件**：打包会跑几十秒到几分钟，控制台被截断时文件就是判据）。
   * @param logFile - 日志文件。
   * @param name - 步骤名。
   * @param action - 这一步的动作。
   * @returns 动作的返回值。
   */
  private async step<T>(logFile: string, name: string, action: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    await this.note(logFile, `[bundle] ${name} …`);
    try {
      const result = await action();
      await this.note(logFile, `[bundle] ${name} ${String(Date.now() - startedAt)}ms`);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? (error.message ?? String(error)) : String(error);
      await this.note(
        logFile,
        `[bundle] ${name} 失败（${String(Date.now() - startedAt)}ms）：${detail}`,
      );
      throw error;
    }
  }

  /**
   * 一行日志：控制台 + 文件。
   * @param logFile - 日志文件。
   * @param line - 文本。
   */
  private async note(logFile: string, line: string): Promise<void> {
    this.logger.info("%s", line);
    await appendFile(logFile, `${line}\n`, "utf8").catch(() => undefined);
  }

  /**
   * @param result - 打包结果。
   * @returns 安装后的路径。
   */
  async install(result: PackResult): Promise<string> {
    const target = join(installRoot(), result.appDir.split("/").at(-1) ?? "app");
    await mkdir(installRoot(), { recursive: true });
    if (process.platform === "darwin") {
      // macOS 上覆盖安装用 `ditto`：按原样保留 framework 的符号链接与元数据，且不需要先删旧包。
      // `maxBuffer` 放大：`ditto` 往 stderr 打进度/警告，默认 1MB 会炸出
      // "stderr maxBuffer length exceeded"（看起来像安装失败，其实已经拷完了）。
      await run("ditto", [result.appDir, target], { maxBuffer: 64 * 1024 * 1024 }).catch(
        (error: unknown) => {
          throw new CliError(
            `安装到 ${target} 失败（先退出正在运行的旧版应用，或检查目标目录的写权限）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      );
      return target;
    }
    await rm(target, { recursive: true, force: true });
    await cp(result.appDir, target, { recursive: true, verbatimSymlinks: true });
    return target;
  }
}

/** 宿主产物里的两项文件（装配入口与清单）。 */
const RUNTIME_FILES = ["bootstrap.mjs", "package.json"] as const;

/** 宿主产物里的目录（前端静态面、源码面入口）——闭包不在这里：它由 `pnpm deploy` 直接装进目标。 */
const RUNTIME_DIRS = ["client_modules", "src"] as const;

/**
 * 把宿主产物装进 `Resources/runtime`：**闭包直接 deploy 到目标**，其余（前端静态面与源码面入口）按清单复制。
 *
 * 为什么不再整份复制：`build` 的闭包是 900MB 级（`node_modules` 一份），复制一次要 20 秒量级、磁盘上还躺着
 * 两份同内容。而 `pnpm deploy` 本来就是「按清单装出一份可分发的应用」的那条规则——直接把它指到最终位置，
 * 就少一次搬运，也少一份副本（`build` 那份仍留给 dev / preview 用）。
 *
 * 为什么其余的还要逐项复制：`<outputDir>` 里还躺着打包自己的中间物（`shell-app/`、`.app`、`bundle.log`），
 * 而 `Resources/runtime` 就在其中——整份复制等于把产物目录往它自己的子目录里拷（Node 直接
 * `ERR_FS_CP_EINVAL`）。清单本身就是「一份可分发的应用」的定义（设计决定 4）。
 * @param input - app 目录、workspace 根与宿主产物根。
 * @param runtimeDir - 目标（`Resources/runtime`）。
 */
async function copyRuntime(input: PackInput, runtimeDir: string): Promise<void> {
  const absent: string[] = [];
  for (const name of [...RUNTIME_FILES, ...RUNTIME_DIRS]) {
    if (!(await exists(join(input.profileDir, name)))) absent.push(name);
  }
  if (absent.length > 0) {
    throw new CliError(
      `宿主产物不齐（${input.profileDir}）：缺 ${absent.join("、")}（先跑 zephyr build）。`,
    );
  }
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  // 闭包：`deploy` 只接受空目录。**装到 `target` 内的暂存目录再 rename 进来**——直接 deploy 进 `.app` 会在
  // 写 `.pnpm` 里的文件时 `EPERM`（实测 `write …/Resources/runtime/node_modules/.pnpm/…: Operation not
  // permitted`；同一路径下 mkdir / hardlink / clonefile 都正常，是 deploy 自己那套写法的限制）。
  // 暂存与目标同设备，`rename` 是原子移动：既没有那 900MB 的复制，也不受 `.app` 内那条限制影响。
  const staging = await mkdtemp(join(dirname(input.profileDir), ".zephyr-bundle-deploy-"));
  try {
    await run(
      "pnpm",
      [
        "--filter",
        await appPackageNameOf(input.workspace),
        "--config.inject-workspace-packages=true",
        "deploy",
        "--prod",
        "--config.strictDepBuilds=false",
        staging,
      ],
      { cwd: input.workspace, maxBuffer: 64 * 1024 * 1024 },
    );
    await rename(join(staging, "node_modules"), join(runtimeDir, "node_modules"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  // `verbatimSymlinks` 是必须的：pnpm 的相对链要原样保留，否则 `cp` 会把链接解析成绝对路径，
  // 装出来的应用指回构建机的源码树（冒烟会直接报「逃逸链接」）。
  for (const name of RUNTIME_FILES) {
    await cp(join(input.profileDir, name), join(runtimeDir, name), { verbatimSymlinks: true });
  }
  for (const name of RUNTIME_DIRS) {
    await cp(join(input.profileDir, name), join(runtimeDir, name), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

/**
 * 工作区根（`pnpm-workspace.yaml` 所在目录）：`pnpm --filter` 要在它下面跑。
 * @returns 绝对路径。
 * @throws CliError 找不到工作区根。
 */
async function workspaceRootOf(): Promise<string> {
  for (let dir = shellPackageDir(); ; dir = dirname(dir)) {
    if (await exists(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) {
      throw new CliError("找不到 pnpm-workspace.yaml：desktop bundle 要在 pnpm 工作区里跑。");
    }
  }
}

/**
 * 壳包的目录。
 * @returns 绝对路径。
 */
function shellPackageDir(): string {
  const entry = import.meta.resolve(`${SHELL_PACKAGE}/package.json`);
  return dirname(new URL(entry).pathname);
}

/**
 * 在产物目录里找一个应用（macOS 是 `.app`，其它平台是平铺的目录）。
 * @param output - `directories.output`。
 * @returns 应用目录的绝对路径。
 */
async function discoverAppDir(output: string): Promise<string> {
  const outer = await readdir(output).catch(() => [] as string[]);
  for (const entry of outer) {
    const platformDir = join(output, entry);
    const inner = await readdir(platformDir).catch(() => [] as string[]);
    const app = inner.find((name) => name.endsWith(".app"));
    if (app !== undefined) return join(platformDir, app);
  }
  return output;
}

/**
 * 系统应用目录（macOS 是 `/Applications`，Linux 是 `~/.local/share/applications`）。
 * @returns 目录。
 */
function installRoot(): string {
  if (process.platform === "darwin") return "/Applications";
  const home = process.env.HOME ?? "";
  return join(home, ".local", "share", "applications");
}

/**
 * 文件在不在（异步：命令行不占事件循环）。
 * @param path - 绝对路径。
 * @returns 判断结果。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
