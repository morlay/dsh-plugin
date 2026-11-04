import { logOf } from "@local/devkit/log";
import { access, cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, type CliOptions } from "electron-builder";
import type { AppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import type { PreparedIcons } from "./icon.ts";

type DesktopConfiguration = Exclude<NonNullable<CliOptions["config"]>, string>;

const log = logOf("dshdev");

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
    // **开 asar**：壳的入口是引导 + `dist/index.mjs`，宿主跑的是 Electron 的 node（`ELECTRON_RUN_AS_NODE`），
    // asar 补丁对它照样生效——入口与整棵依赖树都能留在归档里，只有 native（`*.node`，`dlopen` 要真文件）
    // 拆到 `app.asar.unpacked/`。判据与取舍见
    // `../.agents/designs/20261016-随包布局：app 进 asar、宿主依赖住 runtime.md`。
    asar: true,
    asarUnpack: ["**/*.node"],
    // **不做 native 重编**：app 目录里那份依赖是**宿主**的（宿主跑在随包的真 node 上），它里面的原生模块
    // 已经按那个 node 装好了；按 Electron 的 ABI 再编一遍既不对（壳自己不用它们），也会去写全局的
    // `~/.electron-gyp`（`@electron/rebuild` 把那个路径硬编码在 home 下）。
    npmRebuild: false,
    // 装配目录（`buildCache/shell`）里要进产物的东西：**引导**（Electron 的 `main`）、转译后的字节与本地化。
    // 产物就是**整包的源码**加那个入口：preload 的 CJS 由宿主机现场打包（见 `preload-source.ts`），
    // 所以装配目录里没有 `dist/`。逐项列清楚（不用通配：`dist/**` 那种写法实测会漏件）。
    files: ["main.mjs", "package.json", "src/**", "dist/**", "locale/*.json"],
    extraResources: [
      // profile 的解析面：闭包 + 清单，落在 `Resources/profile`（asar **外**的真目录——宿主按路径读它，
      // 不必依赖 asar 补丁；首启也不用再落一份）。
      { from: join(buildCache, "runtime"), to: "runtime" },
      { from: join(buildCache, "seed"), to: "seed" },
      { from: join(buildCache, "runtime", "appconfig.json"), to: "appconfig.json" },
    ],
    // **profile 的解析面**（bundle 与它们的依赖）：`extraResources` 指望不上——electron-builder 的默认
    // 忽略规则里有 `**/node_modules/**`，而这一份**就是** node_modules（实测：目录建了、非 node_modules
    // 的文件也拷了，唯独它是空的；显式 `filter: ["**/*"]` 覆盖不掉）。所以放在打包之后自己放。
    //
    // **不再在这里跑第二次 `pnpm deploy`**：`prepareSeed` 已经产出了同一份闭包（`<buildCache>/deploy`，
    // 含顶层挂平）。同一个装配跑两遍，第二次在 electron-builder 进程里会拿到另一套结果（实测：工作区包
    // 被换成发布版清单，`main`/`exports` 指 `lib/index.js`，而包目录里只有 `src` 没有 `lib`——宿主启动
    // 时整片 `ERR_MODULE_NOT_FOUND`）。一次装配、两处一致。
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
      await installProfileClosure(resources, buildCache);
    },
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

/**
 * 把 `prepareSeed` 产出的部署闭包原样铺到产物的 `Resources/profile`。
 *
 * **复制而不是再 deploy 一次**：闭包只有一份（`<buildCache>/deploy`，`deployClosure` 已把 `.pnpm` 的包
 * 挂平到顶层），打包只负责搬。符号链接按原样保留（`verbatimSymlinks`）：顶层包都是指进 `.pnpm` 的
 * **相对**链接，跟产物一起搬走仍然是有效的；解析成绝对路径就会指回构建机。
 *
 * @param resources - 产物里的 `Resources` 目录（mac 是 `.app/Contents/Resources`）。
 * @param buildCache - 打包工作目录（`<workspace>/node_modules/.dshdev`）。
 */
export async function installProfileClosure(resources: string, buildCache: string): Promise<void> {
  const target = join(resources, "profile");
  await rm(target, { recursive: true, force: true });
  await cp(join(buildCache, "deploy"), target, { recursive: true, verbatimSymlinks: true });
}

export async function buildDesktopApp(options: DesktopBuildOptions): Promise<string[]> {
  const { buildCache, appConfig, icons, dir } = options;
  const appDir = await prepareShellAppDirectory(options);
  // 打包前把 app 目录摊开看一眼：electron-builder 只按 `files` 取件，缺件时从这里能立刻分辨"没装出来"
  // 还是"没打进去"。
  log.info("shell.app %o", { dir: appDir, entries: await readdir(appDir) });
  const distDir = join(appDir, "dist");
  log.info("shell.dist %o", { entries: await readdir(distDir).catch(() => ["(无 dist)"]) });
  const electron = await installedElectron();
  log.info("builder %o", {
    appId: appConfig.id,
    productName: appConfig.displayName,
    version: appConfig.version,
    electron: electron.version,
  });
  return build({
    projectDir: appDir,
    config: desktopBuildConfig({ buildCache, appConfig, icons, electron }),
    publish: "never",
    dir,
  });
}
