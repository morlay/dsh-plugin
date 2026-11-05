// `zephyr desktop bundle`：构建（缺产物时）→ 推导 electron-builder 配置 → 打包 → 可选安装。
//
// 为什么这里允许「顺手 build」而行 `preview` 不许：bundle 的产物本身就包含构建结果（静态面进
// Resources、闭包进 profile），没有构建就没有包；而 preview 的用途是**验证已有产物**。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import {
  BuildSteps,
  CliError,
  Command,
  type CommandInput,
  type ParamSpecs,
  runBuild,
  Workspace,
} from "@morlay/zephyr-cli";
import { electronBuilderConfigOf } from "../electron-builder.ts";
import { prepareIcons } from "../icons.ts";
import { Packager } from "../packager.ts";

/**
 * 应用的包名（`pnpm --filter <名字> deploy` 用）。
 * @param workspace - 应用工作区。
 * @returns 包名。
 * @throws CliError 读不到 `package.json` 或没有 `name`。
 */
async function appPackageNameOf(workspace: string): Promise<string> {
  const raw = await readFile(join(workspace, "package.json"), "utf8").catch(() => undefined);
  if (raw === undefined) {
    // 工作区没有清单（装配级测试的临时目录就是这样）：退回目录名，deploy 交给包装层去判。
    return basename(workspace);
  }
  const manifest = JSON.parse(raw) as { name?: string };
  return manifest.name ?? basename(workspace);
}

/**
 * Electron 版本：`electron` 是壳的 peer，由仓库里装的那份决定。
 *
 * 用 `import.meta.resolve` 拿到包的**入口文件**，包根就是它的目录（`electron` 的入口在包根）。
 * app 目录是应用闭包、没有 `electron`，所以这个版本必须显式交给 electron-builder。
 * @returns 版本号（如 `45.2.3`）。
 * @throws CliError 解析不到 electron。
 */
async function electronVersionOf(): Promise<string> {
  try {
    const entry = import.meta.resolve("electron");
    const manifest = JSON.parse(
      await readFile(join(dirname(fileURLToPath(entry)), "package.json"), "utf8"),
    ) as { version: string };
    return manifest.version;
  } catch {
    throw new CliError("解析不到 electron 的版本：壳的 peer 依赖没装（先 pnpm install）。");
  }
}

/** `zephyr desktop bundle`。 */
@Injectable({ multi: true })
export class BundleCommand extends Command {
  readonly path = ["desktop", "bundle"];

  readonly description = "打一个静态、无签名的桌面应用目录（缺省不产安装包）";

  readonly params: ParamSpecs = {
    install: { kind: "boolean", description: "打完之后装进系统应用目录" },
  };

  private readonly steps = inject(BuildSteps);

  private readonly packager = inject(Packager);

  private readonly resolved = inject(Workspace);

  private readonly logger = inject(Logger);

  /**
   * @param input - 参数（目前只有 `--install`）。
   * @returns 退出码。
   */
  async run(input: CommandInput): Promise<number> {
    const layout = this.resolved.layout;
    // **无条件先构建**：包里装的是构建产物（`entry.mjs`、`dist/`），而"有没有现成产物"判断不出它是否
    // 与当前源码一致——用旧产物打出来的包会带着已经改掉的代码（实测踩过：改了宿主装配面，bundle 却
    // 打了上一份 `entry.mjs`）。所以每次 bundle 都重建，代价是几分钟，换的是"包与源码一致"。
    await runBuild({ resolved: this.resolved, layout }, this.steps);
    await mkdir(layout.root, { recursive: true });
    await writeFile(
      join(layout.root, "desktop.json"),
      JSON.stringify(this.resolved.config.desktop ?? {}, null, 2),
      "utf8",
    );
    const icons = await prepareIcons({
      workspace: this.resolved.workspace,
      outRoot: layout.root,
      icon: this.resolved.config.desktop?.icon,
    });
    const config = electronBuilderConfigOf({
      resolved: this.resolved,
      layout,
      electronVersion: await electronVersionOf(),
      ...(Object.keys(icons).length === 0 ? {} : { icons }),
    });
    const result = await this.packager.pack(config, {
      // app 目录由 `pnpm --filter 壳 deploy` 现装（依赖合法进 asar）；宿主闭包从 `runtime/` 复制过去。
      appDir: join(layout.root, "shell-app"),
      profileDir: layout.runtime,
      // 闭包按**应用**的依赖算（壳额外要的包已写进应用清单）。
      appPackage: await appPackageNameOf(this.resolved.workspace),
      // 步骤日志落盘：被打断或卡住时，最后一行就是停在哪。
      logFile: join(layout.root, "bundle.log"),
    });
    this.logger.info("[bundle] 产物：%s", result.appDir);
    if (input.params.install === true) {
      const target = await this.packager.install(result);
      this.logger.info("[bundle] 已安装：%s", target);
    }
    return 0;
  }
}
