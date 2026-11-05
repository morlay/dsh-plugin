// Electron 主进程入口：**一张清单一个生命周期**（壳行 + 宿主行同树）。
//
// 两条硬约束：
// 1. **不能在本模块顶层 `await app.whenReady()`**：Electron 要等主进程入口模块**求值完成**才触发
//    ready，在顶层等 ready 就是死锁（症状：进程在、窗口不出、端口不监听，日志停在 "等 app ready"）。
//    所以 ready 之后的逻辑全部放进 `start()`，由 `whenReady().then(...)` 触发。
// 2. **electron 必须走静态 `import`**：Electron 的 ESM 主进程会把内置 `electron` 模块注入进来。
//    用 `createRequire(import.meta.url)("electron")` 会绕过那个补丁——在 asar 内解析到
//    `node_modules/electron`（导出可执行文件路径字符串）或干脆 `Cannot find module 'electron'`，
//    两种结果都会让 `electron.app` 不可用。
import * as electronBuiltin from "electron";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProviderList } from "@morlay/zephyr";
import type { CliModeValues, ZephyrDesktopConfig } from "@morlay/zephyr-cli";
import { shellDebugOf } from "./debug.ts";
import { reportEvent, reportFailure } from "./failure.ts";
import { DESKTOP_IPC } from "./ipc.ts";
import { loginShellEnv, mergeMissingEnv } from "./shell-env.ts";
import { installShortcuts } from "./shortcuts.ts";
import type { ElectronLike } from "./provide.ts";
import { windowOptionsOf } from "./window.ts";

const electron = electronBuiltin as unknown as ElectronLike;

/** 一个窗口实例（类型从 `ElectronLike` 的构造面派生，壳不静态依赖 electron 的类型包）。 */
type ShellWindow = InstanceType<ElectronLike["BrowserWindow"]>;

/** 形态只从环境来：`dev`（页面走 dev server）/ `packaged`（页面与宿主都在随包产物里）。 */
const dev = process.env.ZEPHYR_DESKTOP_MODE === "dev";

// 打包形态给同进程的宿主打标记：应用据此把 `dev.include` 清空（全部预构建）。
if (!dev) process.env.ZEPHYR_DESKTOP_PACKAGED = "1";

// 告诉**同进程里的宿主**现在是打包形态：它据此决定客户端模块走预构建还是 vite dev。
// （`zephyr dev` 与 `desktop dev` 都没有这个标记 → 宿主按开发形态跑。）
/** 调试面（日志 + DevTools）：`desktop dev` 默认开，可用 `ZEPHYR_DESKTOP_DEBUG=0` 关掉。 */
const debug = shellDebugOf();

/**
 * `Resources` 的根：打包形态是 `process.resourcesPath`；**不用打整包**就能验打包分支时，用
 * `ZEPHYR_DESKTOP_RESOURCES_ROOT` 指到 `.zephyr`（那里并列着 `dist/`、`runtime/`）。
 * @returns 绝对路径（未打包且没给覆盖时是空串）。
 */
function resourcesPath(): string {
  const fromEnv = process.env.ZEPHYR_DESKTOP_RESOURCES_ROOT;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return (process as unknown as { resourcesPath?: string }).resourcesPath ?? "";
}

// **目录名用应用的 id**（`ai.deepseek.zephyr.custom`），不用显示名：显示名会变，id 不变；而且显示名
// 里的空格进路径只会带来麻烦。两层：
//   ~/Library/Application Support/<id>/electron/   ← Electron 的 userData（缓存、偏好、磁盘存储）
//   ~/Library/Application Support/<id>/            ← DSH_HOME（`data/`、`cache/`）
//
// id 来自 `desktop.json`（打包）或环境变量（dev）—— 读它要在 ready 之前，所以**不能**等 ready，
// 但可以顶层 await（Electron 等的是入口模块求值完成，不是 ready）。
const desktopIdentity = await readDesktop();
const dataRoot = join(
  electron.app.getPath("appData"),
  desktopIdentity?.id ?? electron.app.getName(),
);
const userDataOverride = process.env.ZEPHYR_DESKTOP_USER_DATA;
electron.app.setPath(
  "userData",
  userDataOverride === undefined || userDataOverride === ""
    ? join(dataRoot, "electron")
    : userDataOverride,
);

// 受限环境（容器 / 无 GPU / 无沙箱权限）里 Electron 的 GPU 与沙箱进程会 FATAL 退出。
// 这两个开关必须在 ready 之前设；由 `desktop dev` 通过环境变量显式打开，打包形态不受影响。
if (process.env.ZEPHYR_DESKTOP_NO_SANDBOX === "1") {
  electron.app.commandLine.appendSwitch("no-sandbox");
  electron.app.disableHardwareAcceleration();
}

// ready 之后的全部工作：不阻塞模块求值。
electron.app
  .whenReady()
  .then(start)
  .catch(async (error: unknown) => {
    // 打包形态看不见 stderr：这条也必须落文件，否则「双击没反应」。
    await reportFailure("启动", error);
    electron.app.quit();
  });

/**
 * 起壳：装 TS 运行时（dev）→ 登记协议（打包）→ 装配壳 + 宿主 → 开窗口。
 * @returns 装配完成后无返回（生命周期跟着窗口与 app 走）。
 */
async function start(): Promise<void> {
  // 先补外部环境（GUI 启动的 PATH 往往缺 homebrew 等）：壳里派生出去的终端 / git / pnpm 依赖它。
  // 只补白名单（PATH / locale / XDG），且**不打印键名**：登录 shell 里还有一堆凭证。
  const filled = mergeMissingEnv(process.env, await loginShellEnv());
  debug.log(`已补登录 shell 环境：${String(filled.length)} 项`);
  installDirectoryPicker();
  // 快捷键桥：页面侧的 `provideShortcuts()` 依赖它（缺了那一行构造失败）。
  installShortcuts({
    electron,
    userData: process.env.ZEPHYR_DESKTOP_USER_DATA ?? electron.app.getPath("userData"),
    getWindow: () => primaryWindow,
  });
  await reportEvent("start：环境与桥就绪");
  const desktop = desktopIdentity;
  // dev 形态：窗口只是一个浏览器，页面与资源全走工作区的 dev server（vite）。
  // 这条路上不装 TS loader、不装配宿主——宿主在 `zephyr dev` 那个进程里，壳不该跑两份。
  if (dev) {
    await openWindow(desktop, process.env.ZEPHYR_DESKTOP_URL ?? "http://127.0.0.1:3080/");
    return;
  }
  // **工作目录对齐**：CLI 起子进程时 cwd = 应用工作区；壳启动时把它设成闭包目录（`Resources/runtime`，
  // 真目录）。两者都让"装配根 = cwd"，应用与各条链不需要为形态分叉。
  const runtimeDir = join(resourcesPath(), "runtime");
  process.chdir(runtimeDir);
  await reportEvent("start：工作目录", runtimeDir);
  await reportEvent("start：装配宿主（与 dev 同一套）");

  // **与宿主共用同一份 `@morlay/zephyr`**：从闭包里解析（`runtime/node_modules`）。壳自己那份会在
  // 同进程里形成第二套服务令牌表——症状是 `service "remote-descriptor" has been registered at <root>`。
  const { bootstrapApplication } = await importZephyr(runtimeDir);
  const app = await bootstrapApplication({
    providers: [...(await reportEvent("start：装配宿主清单").then(hostProviders))],
    timeoutMs: 60_000,
  });

  // **与 desktop dev 一模一样的跑法**：宿主自己起 vite，页面从 http 进。唯一的差别是装配面
  // （`Resources/runtime` 而不是工作区）与数据根（用户数据目录而不是工作区）。
  const port = process.env.PORT ?? "3080";
  const url = `http://127.0.0.1:${port}/`;
  await reportEvent("start：等宿主就绪", url);
  await openWindow(desktop, url);

  electron.app.on("window-all-closed", () => {
    void app.dispose().finally(() => electron.app.quit());
  });
}

/** 当前窗口（目录选择器要挂在它上面：父窗口、最小化恢复、以及「只认拥有窗口的 renderer」）。 */
let primaryWindow: ShellWindow | undefined;

/** 进行中的选择：同一窗口重复点击复用同一个对话框，不叠开。 */
let pendingPick: Promise<string | null> | undefined;

/**
 * 原生目录选择器：渲染进程通过 preload 的 `__DSH_DIRECTORY_PICKER__.pick()` 请求。
 *
 * 三条判据与参考实现一致：只认**拥有窗口**的 renderer、同一窗口的选择去重、窗口最小化时先恢复再弹。
 */
function installDirectoryPicker(): void {
  electron.ipcMain.handle(DESKTOP_IPC.directoryPick, async (event: { senderId?: number }) => {
    const window = primaryWindow;
    if (window === undefined || window.isDestroyed()) return null;
    // 不认野 renderer：只有我们自己那个窗口能弹原生对话框。
    if (event.senderId !== undefined && !window.owns(event.senderId)) return null;
    if (pendingPick !== undefined) return pendingPick;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    pendingPick = electron.dialog
      .showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })
      .then((result) => (result.canceled ? null : (result.filePaths[0] ?? null)))
      .finally(() => {
        pendingPick = undefined;
      });
    return pendingPick;
  });
}

/**
 * 开窗口并加载一个地址。
 * @param desktop - 配置里的 `desktop` 段（窗口尺寸）。
 * @param url - 页面地址。
 * @returns 加载完成（失败只记录，不退出：窗口还在，能看错误页）。
 */
async function openWindow(desktop: ZephyrDesktopConfig | undefined, url: string): Promise<void> {
  // preload 与 main 同目录（构建产物并排）。
  const created = new electron.BrowserWindow(
    windowOptionsOf(desktop, process.platform, join(import.meta.dirname, "preload.mjs")),
  );
  // 目录选择器只认这一个窗口：把 webContents id 绑上去，后续请求按它准入。
  const window: ShellWindow = Object.assign(created, {
    owns: (senderId: number) => created.webContents.id === senderId,
  });
  primaryWindow = window;
  // 渲染进程的 console：白屏的唯一现场（模块 404 / 语法错 / CSP 都只在这里说）。
  if (debug.enabled) {
    window.webContents.on("console-message", (...args: never[]) => {
      const detail = args as unknown as [{ message?: string }, number, string];
      debug.renderer(String(detail[2] ?? detail[0]?.message ?? ""));
    });
  }
  window.once("ready-to-show", () => window.show());
  // 调试面打开时带 DevTools：白屏时 Network / Console 是唯一能看全的地方。
  if (debug.enabled) window.webContents.openDevTools({ mode: "detach" });
  try {
    await reportEvent("窗口：加载页面", url);
    await window.loadURL(url);
    await reportEvent("窗口：加载完成", url);
    debug.log(`已加载 ${url}`);
  } catch (error) {
    // 打包形态收不到 stderr：这条必须落文件（否则表现就是「窗口没出来、进程自己退了」）。
    await reportFailure("加载页面", error);
  }

  electron.app.on("window-all-closed", () => electron.app.quit());
}

/**
 * 从闭包里加载 `@morlay/zephyr`（与宿主同一份）。
 * @param runtimeDir - 闭包根（`Resources/runtime`）。
 * @returns 该模块的命名空间（只用到 `bootstrapApplication`）。
 */
async function importZephyr(runtimeDir: string): Promise<{
  bootstrapApplication: (options: {
    providers: ProviderList;
    timeoutMs: number;
  }) => Promise<{ dispose(): Promise<void> }>;
}> {
  const requireFromRuntime = createRequire(join(runtimeDir, "package.json"));
  const entry = requireFromRuntime.resolve("@morlay/zephyr");
  return (await import(pathToFileURL(entry).href)) as {
    bootstrapApplication: (options: {
      providers: ProviderList;
      timeoutMs: number;
    }) => Promise<{ dispose(): Promise<void> }>;
  };
}

/**
 * 宿主行（应用清单）：打包形态读闭包里的入口。
 * @returns 提供清单。
 */
async function hostProviders(): Promise<ProviderList> {
  // 宿主入口在 **asar 之外**的 `Resources/runtime`（闭包根，与壳的工作目录同一处）。
  const entry =
    process.env.ZEPHYR_DESKTOP_HOST_ENTRY ?? join(resourcesPath(), "runtime", "entry.mjs");
  const module = (await import(pathToFileURL(entry).href)) as {
    default?: unknown;
    providers?: unknown;
  };
  const exported = module.providers ?? module.default;
  // 入口可以导出**清单**或 **(mode) => 清单**：部署值（工作区、数据目录）只有它知道怎么用。
  const providers =
    typeof exported === "function"
      ? (exported as (mode: CliModeValues) => ProviderList)(shellMode())
      : exported;
  if (!Array.isArray(providers)) {
    throw new Error(`${entry} 没有导出 provider 清单（默认导出 / providers / (mode) => 清单）。`);
  }
  return providers;
}

/**
 * 壳侧的部署值：壳不是 CLI，拿不到 `CliMode`，但宿主清单需要这些值。
 * @returns 与 `CliModeValues` 同形的对象（由 `desktop dev` 的环境变量给出）。
 */
/**
 * 壳侧的部署值：`dev` 是**形态**（壳由 `ZEPHYR_DESKTOP_MODE` 判断，应用只看这个值）。
 * @returns 与 `CliModeValues` 同形的对象。
 */
function shellMode(): CliModeValues {
  // dev：`desktop dev` 把**应用工作区**递进来（宿主读它的 `package.json` / `src/client`）。
  const fromEnv = process.env.ZEPHYR_DESKTOP_WORKSPACE;
  if (fromEnv !== undefined) {
    return {
      command: ["desktop", "dev"],
      workspace: fromEnv,
      profileDir: fromEnv,
      dataDir: process.env.ZEPHYR_DESKTOP_DATA_DIR ?? join(fromEnv, "workspace"),
      dataDirSpec: "workspace",
      configFile: "",
    };
  }
  // 打包：**装配面是 `Resources/runtime`（真目录，asar 之外）**——闭包的 `package.json`、`src/client`、
  // `node_modules`、`entry.mjs` 都在那里。必须是真目录：应用拿 `process.cwd()` 当装配根，而 `chdir`
  // 进不了 asar。**数据根在用户目录**（只读位置写不进去，也不能是 `/`）。
  const workspace = join(resourcesPath(), "runtime");
  // `DSH_HOME` **就是** `~/Library/Application Support/<desktop.id>` 这一层：它的下面
  // 只有 `electron/`（Electron 的 userData）与 `cache/`（运行期缓存，如 `.dsh-client-modules`）。
  const dataDir = process.env.ZEPHYR_DESKTOP_DATA_DIR ?? appDataRoot();
  return {
    command: ["desktop", "dev"],
    workspace,
    profileDir: workspace,
    dataDir,
    dataDirSpec: "xdg",
    configFile: "",
  };
}

/**
 * 用户数据目录（`~/Library/Application Support/<产品名>`）：asar 只读，可写的只有这里。
 * @returns 绝对路径。
 */
function appDataRoot(): string {
  // **数据根**（不是 Electron 的 userData）：`~/Library/Application Support/<name>/` 这一层，
  // Electron 自己的东西在它下面的 `electron/`。
  return dataRoot;
}

/**
 * 读桌面身份：dev 由环境变量给，打包形态读 `Resources/desktop.json`。
 * @returns 配置里的 `desktop` 段，或 `undefined`。
 */
async function readDesktop(): Promise<ZephyrDesktopConfig | undefined> {
  const fromEnv = process.env.ZEPHYR_DESKTOP_DESKTOP;
  if (fromEnv !== undefined) return JSON.parse(fromEnv) as ZephyrDesktopConfig;
  try {
    return JSON.parse(
      await readFile(join(resourcesPath(), "desktop.json"), "utf8"),
    ) as ZephyrDesktopConfig;
  } catch {
    return undefined;
  }
}
