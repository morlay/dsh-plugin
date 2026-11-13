// 桌面侧的**路径部署值**：应用根与 userData 由这里一处算出（壳只 `app.setPath`，不自己拼 appData）。
//
// 各形态的默认值（**可读、不哈希**）：
//   dev：`<appData>/<desktop.id>/dev`   打包 / bundle / preview：`<appData>/<desktop.id>`
//   userData 一律是应用根下的 `electron/`
// 显式值优先（`ZEPHYR_DESKTOP_USER_DATA`）：多工作区并行、临时目录都靠它，不靠自动隔离。
import { join } from "node:path";

/** Electron `userData` 在应用根下的目录名（各形态共用一条规则）。 */
export const USER_DATA_SUBDIR = "electron";

/**
 * 操作系统的 appData 目录（与 Electron `app.getPath("appData")` 同一口径）。
 *
 * **本仓库只有这一处算 appData**：壳侧只收结果。
 * @param env - 环境变量（测试可注入）。
 * @param platform - 平台（测试可注入）。
 * @param home - 用户主目录。
 * @returns 绝对路径。
 */
export function appDataHomeOf(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (platform === "darwin") return join(home, "Library", "Application Support");
  if (platform === "win32") return env.APPDATA ?? join(home, "AppData", "Roaming");
  const xdg = env.XDG_CONFIG_HOME;
  return xdg === undefined || xdg === "" ? join(home, ".config") : xdg;
}

/**
 * 应用根：`<appData>/<desktop.id>`（打包 / bundle / preview），dev 形态多一段 `dev`。
 *
 * 不做「按工作区哈希隔离」：目录名要可读；多工作区并行靠显式 `ZEPHYR_DESKTOP_USER_DATA`。
 * @param input - appData 目录、桌面身份的应用 id 与形态。
 * @returns 绝对路径。
 */
export function appRootOf(input: {
  readonly appDataHome: string;
  readonly desktopId: string;
  readonly form: "dev" | "packaged";
}): string {
  const root = join(input.appDataHome, input.desktopId);
  return input.form === "dev" ? join(root, "dev") : root;
}

/**
 * `userData`：应用根下的 `electron/`（Electron 的 `setPath` 不会替你建目录，调用方负责 `mkdir`）。
 * @param appRoot - 应用根（{@link appRootOf} 的结果）。
 * @returns 绝对路径。
 */
export function userDataDirOf(appRoot: string): string {
  return join(appRoot, USER_DATA_SUBDIR);
}

/**
 * 打包形态的启动器源码：算出部署值交给壳，然后加载壳的主进程入口。
 *
 * 为什么要有它：Finder 启动的进程没有环境变量，而 `userData` 只能在 ready 之前 `setPath`。
 * 这份源码由 {@link import("./packager.ts")} 在打包时写进 app 目录，作为 `main` 的第一跳；
 * 算法只有这里一处（壳不再自己算 appData）。
 * @returns 启动器源码（ESM）。
 */
export function packagedBootstrap(): string {
  return `// 打包形态的启动器：由 @morlay/zephyr-desktop-bundle 在打包时写入 app 目录。
// 它只做一件事：把部署值（userData 与数据根）交给壳，然后加载壳的主进程入口。
// 显式 ZEPHYR_DESKTOP_USER_DATA 优先（多实例 / 临时 profile 都靠它）。
import { app } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const desktop = JSON.parse(await readFile(join(process.resourcesPath, "desktop.json"), "utf8"));
const root = join(app.getPath("appData"), desktop.id);
if (process.env.ZEPHYR_DESKTOP_USER_DATA === undefined) {
  process.env.ZEPHYR_DESKTOP_USER_DATA = join(root, "${USER_DATA_SUBDIR}");
}
if (process.env.ZEPHYR_DESKTOP_DATA_DIR === undefined) {
  process.env.ZEPHYR_DESKTOP_DATA_DIR = root;
}
await import("./dist/main.mjs");
`;
}
