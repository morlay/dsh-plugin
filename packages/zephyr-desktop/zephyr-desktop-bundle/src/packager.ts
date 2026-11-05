// 打包动作的接缝：**配置推导**留在纯函数里，**真正调用 electron-builder** 放在这里。
//
// app 目录怎么来：**用 `pnpm --filter @morlay/zephyr-desktop-shell deploy` 装**（壳的依赖图完整、lock
// 一致，electron-builder 才会按图收集进 asar）。手拷进去的包它不认——那是之前 `oxc-transform`
// 静默消失的原因。
//
//   <app>/
//   ├── dist/            壳的产物（deploy 自带，壳的 `files` 里有 `dist`）
//   ├── node_modules/    壳的依赖（含 `@morlay/dsh-oxc-node` → `oxc-transform`）
//   ├── profile/         宿主闭包（`build` 的 `runtime/`）
//   └── package.json     入口改写为 `./dist/main.mjs`
import { access, appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { CliError } from "@morlay/zephyr-cli";
import type { ElectronBuilderConfig } from "./electron-builder.ts";

const run = promisify(execFile);

/** 壳的包名（`dist/` 从这里取）。 */
const SHELL_PACKAGE = "@morlay/zephyr-desktop-shell";

/** 一次打包的结果。 */
export interface PackResult {
  /** 产出的应用目录（`.zephyr/app/<平台>-<架构>/<产品名>.app` 之类）。 */
  readonly appDir: string;
}

/** 打包所需的输入。 */
export interface PackInput {
  /** app 目录（electron-builder 的 projectDir）。 */
  readonly appDir: string;
  /** 宿主闭包（`build` 的 `runtime/`，含 `entry.mjs`）。 */
  readonly profileDir: string;
  /** 应用包名（deploy 的 filter）：闭包要按**应用**的依赖算，宿主才找得到自己的包。 */
  readonly appPackage: string;
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
    return { appDir: outputs[0] ?? (await discoverAppDir(config.directories.output)) };
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
    await this.step(
      input.logFile,
      `宿主闭包就绪（afterPack 会放到 Resources/runtime）`,
      async () => {
        if (!(await exists(join(input.profileDir, "entry.mjs")))) {
          throw new CliError(
            `宿主闭包里没有 entry.mjs：${input.profileDir}（先跑 zephyr build）。`,
          );
        }
      },
    );
    await this.step(input.logFile, "改写闭包入口为壳的引导", async () => {
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
      manifest.main = "./dist/main.mjs";
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
