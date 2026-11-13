// electron-builder 配置的推导：**纯函数**，因为它几乎全是「字段从哪来」的判断。
//
// 三件事在这里定死：
//   1. 产物落在 `.zephyr/app/`（与 dist / runtime 同级，整目录可删）；
//   2. asar 打开，只有 native（`*.node`）拆到 `app.asar.unpacked`；
//   3. 宿主闭包**就在 asar 里**（app 目录 = 按应用依赖 deploy 的结果）：asar 补丁让 fs 与 import
//      照常读它，打包形态的 AppEnv 因此指向 `app.asar` 本身；静态面走 `extraResources`（asar 外）。
import { cp } from "node:fs/promises";
import { join } from "node:path";
import type { PreparedIcons } from "./icons.ts";
import type { ResolvedConfig } from "@morlay/zephyr-cli";
import { CliError, type ZephyrLayout } from "@morlay/zephyr-cli";

/** 一份可交给 electron-builder 的配置（字段子集，够本次用）。 */
export interface ElectronBuilderConfig {
  /**
   * Electron 版本：**显式给**。
   *
   * app 目录是应用闭包，里面没有 `electron`（那是壳的 peer，由 electron-builder 自己提供），
   * 不写这一项它会去 app 目录的 `node_modules` 里算版本并报
   * `Cannot compute electron version from installed node modules`。
   */
  readonly electronVersion: string;
  readonly appId: string;
  readonly productName: string;
  readonly artifactName: string;
  readonly asar: boolean;
  readonly asarUnpack: readonly string[];
  /** 不做 native 重编（原生模块属于宿主闭包，已按随包 node 的 ABI 装好）。 */
  readonly npmRebuild: boolean;
  readonly directories: { readonly output: string };
  readonly files: readonly string[];
  readonly extraResources: readonly { readonly from: string; readonly to: string }[];
  /** 打包后把宿主闭包放到 `Resources/runtime`（真目录：壳要 `chdir` 进去）。 */
  readonly afterPack: (context: {
    readonly appOutDir: string;
    readonly packager: {
      readonly platform: { readonly name: string };
      readonly appInfo: { readonly productFilename: string };
    };
  }) => Promise<void>;
  readonly mac: {
    readonly category: string;
    readonly identity: null;
    readonly icon?: string;
  };
  readonly win: { readonly icon?: string };
  readonly linux: { readonly category: string; readonly icon?: string };
}

/** 推导所需的三样东西。 */
export interface ElectronBuilderInput {
  /** 解析后的工作区配置（`desktop.id` / `desktop.name` 从它来）。 */
  readonly resolved: ResolvedConfig;
  /** 产物布局。 */
  readonly layout: ZephyrLayout;
  /** Electron 版本（由调用方解析：app 目录是应用闭包，里面没有 `electron`）。 */
  readonly electronVersion: string;
  /** 三平台图标（`desktop.icon` 的生成物）；没配图标就是空。 */
  readonly icons?: PreparedIcons;
}

/**
 * 把配置与布局推导成 electron-builder 的配置。
 * @param input - 工作区配置、布局与壳目录。
 * @returns 配置对象。
 * @throws CliError 缺 `desktop.id` / `desktop.name`。
 */
export function electronBuilderConfigOf(input: ElectronBuilderInput): ElectronBuilderConfig {
  const desktop = input.resolved.config.desktop;
  if (desktop === undefined) {
    throw new CliError("配置里没有 desktop 段：desktop bundle 需要 desktop.id 与 desktop.name。");
  }
  return {
    electronVersion: input.electronVersion,
    appId: desktop.id,
    productName: desktop.name,
    artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
    asar: true,
    asarUnpack: ["**/*.node"],
    // 不做 native 重编：壳自己不用那些原生模块（它们在宿主闭包里，按随包 node 的 ABI 装好了），
    // 按 Electron 的 ABI 再编一遍既不对，也会往 `~/.electron-gyp` 写东西。
    npmRebuild: false,
    directories: { output: join(input.layout.root, "app") },
    // **逐项列，不用通配**（通配实测会漏件）：入口、壳产出的字节、清单。
    // 壳的 `node_modules` 由 electron-builder 按 `package.json` 的 dependencies 自己收集（app 目录是
    // `pnpm --filter 壳 deploy` 的产物，依赖图完整）。
    files: ["dist/**", "bootstrap.mjs", "entry.mjs", "package.json"],
    /**
     * 打包后把**宿主闭包**放到 `Contents/Resources/runtime`（asar 之外的**真目录**）。
     *
     * 两个原因：electron-builder 的默认忽略规则会跳过其中的 node_modules（走 `extraResources` 只会
     * 得到一个空目录）；更关键的是**壳要 `chdir` 到它**——应用拿 `process.cwd()` 当装配根，而
     * `chdir` 进不了 asar（它不是真目录）。
     */
    afterPack: async (context) => {
      const resources =
        context.packager.platform.name === "mac"
          ? join(
              context.appOutDir,
              `${context.packager.appInfo.productFilename}.app`,
              "Contents",
              "Resources",
            )
          : join(context.appOutDir, "resources");
      await cp(input.layout.runtime, join(resources, "runtime"), { recursive: true });
    },
    // 静态面与身份文件放 asar 外：按路径读它们的东西（宿主、将来按路径取页面的消费者）不必依赖 asar 补丁。
    // 页面链现在走宿主自己的 vite（见设计「桌面功能面」第七节的债）：这份 `dist` 目前没有读者。
    extraResources: [
      // 静态面留在 asar 外（`.node` 之外不需要走 asar）。
      { from: input.layout.dist, to: "dist" },
      // 窗口尺寸与应用身份要在壳里读得到：环境变量只覆盖 dev 形态，打包形态靠这份文件。
      { from: join(input.layout.root, "desktop.json"), to: "desktop.json" },
    ],
    // **不签名**：产物是给自己/内测用的目录，签名只会引入钥匙串与证书依赖。
    mac: {
      category: "public.app-category.developer-tools",
      identity: null,
      ...(input.icons?.mac === undefined ? {} : { icon: input.icons.mac }),
    },
    win: input.icons?.win === undefined ? {} : { icon: input.icons.win },
    linux: {
      category: "Development",
      ...(input.icons?.linux === undefined ? {} : { icon: input.icons.linux }),
    },
  };
}
