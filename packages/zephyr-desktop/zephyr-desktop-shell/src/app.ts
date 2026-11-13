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
import type { ElectronLike, ElectronWindow } from "./electron-like.ts";
import { reportEvent, reportFailure } from "./failure.ts";
import { DESKTOP_IPC } from "./ipc.ts";
import { menuTemplateOf } from "./menu.ts";
import { navigationPlanOf } from "./navigation.ts";
import { loginShellEnv, mergeMissingEnv } from "./shell-env.ts";
import { installShortcuts } from "./shortcuts.ts";
import { focusWindowOf } from "./single-instance.ts";
import { DEFAULT_WINDOW_SIZE, windowOptionsOf } from "./window.ts";
import {
  loadWindowState,
  saveWindowState,
  windowStateOf,
  type WindowState,
} from "./window-state.ts";

const electron = electronBuiltin as unknown as ElectronLike;

/** 一个窗口实例（类型从 `ElectronLike` 的构造面派生，壳不静态依赖 electron 的类型包）。 */
type ShellWindow = InstanceType<ElectronLike["BrowserWindow"]>;

/** `will-navigate` 的事件参数（壳只用到能不能拦）。 */
interface NavigationEvent {
  preventDefault(): void;
}

/** 形态只从环境来：`dev`（页面走 dev server）/ `packaged`（页面与宿主都在随包产物里）。 */
const dev = process.env.ZEPHYR_DESKTOP_MODE === "dev";

// 打包形态给同进程的宿主打标记：应用据此把 `dev.include` 清空（全部预构建）。
if (!dev) process.env.ZEPHYR_DESKTOP_PACKAGED = "1";

/** 调试面（日志 + DevTools + 菜单里的开发者项）：`desktop dev` 默认开，可用 `ZEPHYR_DESKTOP_DEBUG=0` 关掉。 */
const debug = shellDebugOf();

// **目录名用应用的 id**（`ai.deepseek.zephyr.custom`），不用显示名：显示名会变，id 不变；而且显示名
// 里的空格进路径只会带来麻烦。两层：
//   ~/Library/Application Support/<id>/electron/   ← Electron 的 userData（缓存、偏好、磁盘存储）
//   ~/Library/Application Support/<id>/            ← DSH_HOME（`data/`、`cache/`）
//
// id 来自 `desktop.json`（打包）或环境变量（dev）—— 读它要在 ready 之前，所以**不能**等 ready，
// 但可以顶层 await（Electron 等的是入口模块求值完成，不是 ready）。
const desktopIdentity = await readDesktop();
// **userData 只从部署值来**：由 `zephyr-desktop-bundle` 一处算出（壳不自己拼 appData，也不读第二个变量
// 兜底——两处各算一次，早晚对不上）。
const userData = await requireUserData();
electron.app.setPath("userData", userData);

// 受限环境（容器 / 无 GPU / 无沙箱权限）里 Electron 的 GPU 与沙箱进程会 FATAL 退出。
// 这两个开关必须在 ready 之前设；由 `desktop dev` 通过环境变量显式打开，打包形态不受影响。
if (process.env.ZEPHYR_DESKTOP_NO_SANDBOX === "1") {
  electron.app.commandLine.appendSwitch("no-sandbox");
  electron.app.disableHardwareAcceleration();
}

/** 上次关窗时的状态（读文件不需要 ready；夹进工作区要等 ready —— `screen` 模块在 ready 前不可用）。 */
const savedWindowState = await loadWindowState(userData);

/** 这次启动要用的窗口状态（`start()` 里算：夹回可见区域要问当前显示器）。 */
let windowState: WindowState | undefined;

/** 当前窗口（目录选择器与单实例聚焦都挂在它上面）。 */
let primaryWindow: ShellWindow | undefined;

/** 进行中的选择：同一窗口重复点击复用同一个对话框，不叠开。 */
let pendingPick: Promise<string | null> | undefined;

/** 宿主树（打包形态才有；关窗后要连它一起收）。 */
let hostApp: { dispose(): Promise<void> } | undefined;

/** 快捷键桥的收尾（退出时释放持久化）。 */
let shortcuts: { dispose(): void } | undefined;

/** 退出只走一次（`window-all-closed` 与错误路径都到这里）。 */
let quitting = false;

// 单实例：**拿不到锁就退出**，第二份宿主会抢同一个数据根（`shortcuts.json`、宿主库）。
// 锁按 userData 认：同一个工作区的两次 `desktop dev` 撞锁，不同工作区互不影响。
if (!electron.app.requestSingleInstanceLock()) {
  await reportEvent("已有实例：聚焦现有窗口后退出");
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    void reportEvent("第二个实例：聚焦现有窗口", focusWindowOf(primaryWindow));
  });
  // ready 之后的全部工作：不阻塞模块求值。
  electron.app
    .whenReady()
    .then(start)
    .catch(async (error: unknown) => {
      // 打包形态看不见 stderr：这条也必须落文件，否则「双击没反应」。
      await reportFailure("启动", error);
      electron.app.quit();
    });
}

/**
 * 起壳：装 TS 运行时（dev）→ 菜单与桥 → 装配壳 + 宿主 → 开窗口。
 * @returns 装配完成后无返回（生命周期跟着窗口与 app 走）。
 */
async function start(): Promise<void> {
  // 先补外部环境（GUI 启动的 PATH 往往缺 homebrew 等）：壳里派生出去的终端 / git / pnpm 依赖它。
  // 只补白名单（PATH / locale / XDG），且**不打印键名**：登录 shell 里还有一堆凭证。
  const filled = mergeMissingEnv(process.env, await loginShellEnv());
  debug.log(`已补登录 shell 环境：${String(filled.length)} 项`);
  installDirectoryPicker();
  // 快捷键桥：页面侧的 `provideShortcuts()` 依赖它（缺了那一行构造失败）。
  shortcuts = installShortcuts({
    electron,
    userData,
    getWindow: () => primaryWindow,
  });
  // 窗口状态要问当前显示器（`screen` 只能在 ready 之后用）。
  windowState = windowStateOf(
    savedWindowState,
    electron.screen.getPrimaryDisplay().workArea,
    initialSize(),
  );
  installMenu();
  // **唯一的退出路径**：最后一个窗口关掉 → 收桥 → 收宿主树 → 退出。
  electron.app.on("window-all-closed", () => void quit());
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
  hostApp = await bootstrapApplication({
    providers: [...(await reportEvent("start：装配宿主清单").then(hostProviders))],
    timeoutMs: 60_000,
  });

  // **与 desktop dev 一模一样的跑法**：宿主自己起 vite，页面从 http 进。唯一的差别是装配面
  // （`Resources/runtime` 而不是工作区）与数据根（用户数据目录而不是工作区）。
  const port = process.env.PORT ?? "3080";
  const url = `http://127.0.0.1:${port}/`;
  await reportEvent("start：等宿主就绪", url);
  await openWindow(desktop, url);
}

/**
 * 收尾：释放快捷键持久化、收宿主树，再退出。
 * @returns 收完即退出。
 */
async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  shortcuts?.dispose();
  await hostApp?.dispose().catch(async (error: unknown) => reportFailure("收起宿主", error));
  electron.app.quit();
}

/**
 * 装产品菜单（裁剪默认菜单：打包形态没有 Reload / DevTools）。
 */
function installMenu(): void {
  const template = menuTemplateOf({
    platform: process.platform,
    appName: desktopIdentity?.name ?? electron.app.getName(),
    debug: debug.enabled,
  });
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}

/**
 * 第一次启动的窗口尺寸（配置里的 `desktop.window`，缺项回落到缺省）。
 * @returns 宽高。
 */
function initialSize(): { readonly width: number; readonly height: number } {
  const window = desktopIdentity?.window;
  return {
    width: window?.width ?? DEFAULT_WINDOW_SIZE.width,
    height: window?.height ?? DEFAULT_WINDOW_SIZE.height,
  };
}

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
 * @param desktop - 配置里的 `desktop` 段（第一次启动的窗口尺寸）。
 * @param url - 页面地址（它的源就是「本源」，其余跳转按 `navigation.ts` 的判据处理）。
 * @returns 加载完成（失败只记录，不退出：窗口还在，能看错误页）。
 */
async function openWindow(desktop: ZephyrDesktopConfig | undefined, url: string): Promise<void> {
  // preload 与 main 同目录（构建产物并排）。
  const created = new electron.BrowserWindow(
    windowOptionsOf(desktop, process.platform, {
      preload: join(import.meta.dirname, "preload.mjs"),
      ...(windowState === undefined ? {} : { state: windowState }),
    }),
  );
  // 目录选择器只认这一个窗口：把 webContents id 绑上去，后续请求按它准入。
  const window: ShellWindow = Object.assign(created, {
    owns: (senderId: number) => created.webContents.id === senderId,
  });
  primaryWindow = window;
  // 关窗时存状态（**只存用户拖动出来的那份**：最大化之前的矩形，下次才能回到原处）。
  window.on("close", () => {
    void saveWindowState(userData, {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
  });
  installNavigationGuards(window, new URL(url).origin);
  // 渲染进程的 console：白屏的唯一现场（模块 404 / 语法错 / CSP 都只在这里说）。
  if (debug.enabled) {
    window.webContents.on("console-message", (...args: never[]) => {
      const detail = args as unknown as [{ message?: string }, number, string];
      debug.renderer(String(detail[2] ?? detail[0]?.message ?? ""));
    });
  }
  if (windowState?.maximized === true) window.maximize();
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
}

/**
 * 装导航判据：**本源放行，外链交系统浏览器，其余拒**。
 * @param window - 窗口。
 * @param origin - 页面自己的源。
 */
function installNavigationGuards(window: ElectronWindow, origin: string): void {
  const openExternal = (target: string): void => {
    // 外部浏览器打不开不该拖住页面：记一笔就完（错误永远落文件）。
    void electron.shell.openExternal(target).catch(async (error: unknown) => {
      await reportFailure("打开外部链接", error);
    });
  };
  // 页面要开新窗口：桌面形态只有一扇窗，一律拒；http(s) 改成交给系统浏览器。
  window.webContents.setWindowOpenHandler((details) => {
    const plan = navigationPlanOf(details.url, origin);
    if (plan.kind === "external") openExternal(plan.url);
    return { action: "deny" };
  });
  // 窗口内的导航（点链接、`location.assign`）：本源放行（vite 自己的换页与 reload 都在这条上）。
  window.webContents.on("will-navigate", (...args: never[]) => {
    const [event, target] = args as unknown as [NavigationEvent, string];
    const plan = navigationPlanOf(target, origin);
    if (plan.kind === "allow") return;
    event.preventDefault();
    if (plan.kind === "external") openExternal(plan.url);
  });
}

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

/**
 * 读部署值里的 userData（Electron 的 profile：页面存储、窗口状态、快捷键、粘住的页面端口）。
 *
 * 缺了就是装配错误：这个值只有 `zephyr-desktop-bundle` 一处能算（见目录契约），壳不自己拼。
 * @returns 绝对路径。
 * @throws 报告后退出——没有 profile 的窗口会写到 Electron 的缺省目录，等于换一个浏览器。
 */
async function requireUserData(): Promise<string> {
  const fromEnv = process.env.ZEPHYR_DESKTOP_USER_DATA;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const error = new Error(
    "没有 ZEPHYR_DESKTOP_USER_DATA：桌面形态的 userData 由 zephyr-desktop-bundle 算出后显式给（壳不自己拼 appData）。",
  );
  await reportFailure("启动", error);
  electron.app.quit();
  throw error;
}

/**
 * 读部署值里的数据根（DSH_HOME）。
 * @returns 绝对路径。
 * @throws 缺值时抛（壳不再造 `<工作区>/workspace` 那样的缺省）。
 */
function requireDataDir(): string {
  const fromEnv = process.env.ZEPHYR_DESKTOP_DATA_DIR;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  throw new Error(
    "没有 ZEPHYR_DESKTOP_DATA_DIR：数据根由 zephyr-desktop-bundle 递（壳不造缺省）。",
  );
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
 * 壳侧的部署值：`dev` 是**形态**（壳由 `ZEPHYR_DESKTOP_MODE` 判断，应用只看这个值）。
 * @returns 与 `CliModeValues` 同形的对象。
 */
function shellMode(): CliModeValues {
  // dev：`desktop dev` 把**应用工作区与数据根**递进来（宿主读工作区的 `package.json` / `src/client`）。
  const fromEnv = process.env.ZEPHYR_DESKTOP_WORKSPACE;
  if (fromEnv !== undefined) {
    return {
      command: ["desktop", "dev"],
      workspace: fromEnv,
      profileDir: fromEnv,
      dataDir: requireDataDir(),
      dataDirSpec: "workspace",
      configFile: "",
    };
  }
  // 打包：**装配面是 `Resources/runtime`（真目录，asar 之外）**——闭包的 `package.json`、`src/client`、
  // `node_modules`、`entry.mjs` 都在那里。必须是真目录：应用拿 `process.cwd()` 当装配根，而 `chdir`
  // 进不了 asar。**数据根在用户目录**（只读位置写不进去，也不能是 `/`）。
  const workspace = join(resourcesPath(), "runtime");
  // 数据根由启动器（打包形态的第一跳）给出：`<appData>/<desktop.id>` 这一层，下面有 `electron/`
  // （Electron 的 userData）与 `cache/`（运行期缓存）。壳不在这里拼 appData。
  const dataDir = requireDataDir();
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
