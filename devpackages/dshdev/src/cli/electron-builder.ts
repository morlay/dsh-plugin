import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, type CliOptions } from "electron-builder";
import type { AppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import type { PreparedIcons } from "./icon.ts";

type DesktopConfiguration = Exclude<NonNullable<CliOptions["config"]>, string>;

export interface DesktopBuildOptions {
  readonly appRoot: string;

  readonly buildCache: string;

  readonly appConfig: AppConfig;

  readonly icons: PreparedIcons;

  readonly dir: boolean;
}

export interface DesktopBuildConfigInput {
  readonly appConfig: AppConfig;

  readonly icons: PreparedIcons;

  readonly electron: { readonly version: string; readonly dist?: string };

  readonly buildCache: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function installedElectron(): Promise<{ readonly version: string; readonly dist?: string }> {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("electron/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: string };
  if (typeof manifest.version !== "string") {
    throw new Error("dshdev: installed electron has no version");
  }
  const dist = join(dirname(manifestPath), "dist");
  return { version: manifest.version, ...((await pathExists(dist)) ? { dist } : {}) };
}

/**
 * app 目录就是 **prebuild 装配好的那个**（`prepareShell` 产出：引导 + 转译后的 `dist` + 清单 + 本地化）。
 *
 * 这里**不要再装一遍**：曾经有过第二套装配（清目录、只拷 `dist`、自己写清单），两套打在同一个
 * `<buildCache>/shell` 上，先装的会被后装的清掉——那正是"装配完却找不到 `dist`"的来源。
 * 现在只补一件 electron-builder 需要的东西：让它的包遍历在工作目录这里停下。
 *
 * @param options - 见 {@link DesktopBuildOptions}。
 * @returns app 目录（装配目录本身）。
 */
export async function prepareShellAppDirectory(options: DesktopBuildOptions): Promise<string> {
  const { appRoot } = options;
  await writeFile(join(appRoot, "pnpm-workspace.yaml"), "packages: []\n");
  return appRoot;
}

// electron-builder 的产物配置：对外名字取 `displayName`（mac 的 `.app`、Windows 的 exe、artifact 名），
// Linux 的可执行名取工作区包名 `name`——electron-builder 的 Linux 可执行名本就读壳 app 目录 `package.json`
// 的 `name`，显式钉住它，安装脚本拼的 `Exec` 才与产物一致。
export function desktopBuildConfig(input: DesktopBuildConfigInput): DesktopConfiguration {
  const { buildCache, appConfig, icons, electron } = input;
  return {
    appId: appConfig.id,
    productName: appConfig.displayName,
    artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
    electronVersion: electron.version,
    ...(electron.dist === undefined ? {} : { electronDist: electron.dist }),
    directories: { output: join(buildCache, "artifacts") },
    // **不用 asar**：壳的入口是原生 ESM（`bootstrap.mjs` -> `dist/index.mjs`），而 Electron 的 ESM 加载器
    // 在 asar 归档里不可靠（要么挂住、要么报找不到）。产物结构与 dev 形态保持一致，少一层差异。
    asar: false,
    // 装配目录（`.dshdev/shell`）里要进产物的东西：**引导**（Electron 的 `main`）、转译后的字节与本地化。
    files: ["bootstrap.mjs", "dist/**", "locale/**", "package.json"],
    extraResources: [
      { from: join(buildCache, "runtime"), to: "runtime" },
      { from: join(buildCache, "seed"), to: "seed" },
      { from: join(buildCache, "runtime", "appconfig.json"), to: "appconfig.json" },
    ],
    mac: {
      category: "public.app-category.developer-tools",
      identity: null,
      target: ["dir"],
      ...(icons.mac === undefined ? {} : { icon: icons.mac }),
    },
    linux: {
      category: "Development",
      target: ["dir"],
      executableName: appConfig.name,
      ...(icons.linux === undefined ? {} : { icon: icons.linux }),
    },
    win: {
      target: ["dir"],
      ...(icons.win === undefined ? {} : { icon: icons.win }),
    },
  };
}

export async function buildDesktopApp(options: DesktopBuildOptions): Promise<string[]> {
  const { buildCache, appConfig, icons, dir } = options;
  const appDir = await prepareShellAppDirectory(options);
  const electron = await installedElectron();
  console.log(
    `desktop bundle: electron-builder appId=${appConfig.id} productName=${appConfig.displayName} version=${appConfig.version} electron=${electron.version}`,
  );
  return build({
    projectDir: appDir,
    config: desktopBuildConfig({ buildCache, appConfig, icons, electron }),
    publish: "never",
    dir,
  });
}
