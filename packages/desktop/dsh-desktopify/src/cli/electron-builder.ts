import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, type CliOptions } from "electron-builder";
import type { AppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import type { PreparedIcons } from "./icon.ts";

type DesktopConfiguration = Exclude<NonNullable<CliOptions["config"]>, string>;

interface ToolManifest {
  readonly name?: string;
  readonly description?: string;
  readonly author?: string;
}

export interface DesktopBuildOptions {
  readonly appRoot: string;

  readonly buildRoot: string;

  readonly appConfig: AppConfig;

  readonly icons: PreparedIcons;

  readonly dir: boolean;
}

export interface DesktopBuildConfigInput {
  readonly appConfig: AppConfig;

  readonly icons: PreparedIcons;

  readonly electron: { readonly version: string; readonly dist?: string };

  readonly buildRoot: string;
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
    throw new Error("dsh-desktopify: installed electron has no version");
  }
  const dist = join(dirname(manifestPath), "dist");
  return { version: manifest.version, ...((await pathExists(dist)) ? { dist } : {}) };
}

export async function prepareShellAppDirectory(options: DesktopBuildOptions): Promise<string> {
  const { appRoot, buildRoot, appConfig } = options;
  const appDir = join(buildRoot, "shell");
  await rm(appDir, { recursive: true, force: true });
  await mkdir(appDir, { recursive: true });
  await cp(join(appRoot, "dist"), join(appDir, "dist"), { recursive: true });
  await writeFile(join(appDir, "pnpm-workspace.yaml"), "packages: []\n");
  const tool = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8")) as ToolManifest;
  await writeFile(
    join(appDir, "package.json"),
    `${JSON.stringify(
      {
        name: tool.name ?? "dsh-desktop-shell",
        version: appConfig.version,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        ...(tool.author === undefined ? {} : { author: tool.author }),
        main: "dist/index.mjs",
      },
      undefined,
      2,
    )}\n`,
  );
  return appDir;
}

// electron-builder 的产物配置：对外名字取 `displayName`（mac 的 `.app`、Windows 的 exe、artifact 名），
// Linux 的可执行名取工作区包名 `name`——electron-builder 的 Linux 可执行名本就读壳 app 目录 `package.json`
// 的 `name`，显式钉住它，安装脚本拼的 `Exec` 才与产物一致。
export function desktopBuildConfig(input: DesktopBuildConfigInput): DesktopConfiguration {
  const { buildRoot, appConfig, icons, electron } = input;
  return {
    appId: appConfig.id,
    productName: appConfig.displayName,
    artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
    electronVersion: electron.version,
    ...(electron.dist === undefined ? {} : { electronDist: electron.dist }),
    directories: { output: join(buildRoot, "artifacts") },
    asar: true,
    files: ["dist/**", "package.json"],
    extraResources: [
      { from: join(buildRoot, "runtime"), to: "runtime" },
      { from: join(buildRoot, "seed"), to: "seed" },
      { from: join(buildRoot, "runtime", "appconfig.json"), to: "appconfig.json" },
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
  const { buildRoot, appConfig, icons, dir } = options;
  const appDir = await prepareShellAppDirectory(options);
  const electron = await installedElectron();
  console.log(
    `desktop bundle: electron-builder appId=${appConfig.id} productName=${appConfig.displayName} version=${appConfig.version} electron=${electron.version}`,
  );
  return build({
    projectDir: appDir,
    config: desktopBuildConfig({ buildRoot, appConfig, icons, electron }),
    publish: "never",
    dir,
  });
}
