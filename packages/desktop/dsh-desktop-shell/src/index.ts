import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { format } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol } from "./electron.ts";

declare global {
  /** 壳的包根：由引导（`bootstrap.mjs`，它就在包根）写入；发布包里没有引导时为 undefined。 */
  // eslint-disable-next-line no-var -- 引导与业务代码之间的约定。
  var __DSH_SHELL_ROOT__: string | undefined;
}

import type { BrowserWindow as BrowserWindowType, BrowserWindowConstructorOptions } from "electron";
import { DESKTOP_HOST_PACKAGE } from "./official.ts";
import { PRELOAD_SOURCE_PATH } from "@morlay/dsh-desktop-host/preload-source";
import { loadAppConfig, PROFILE_NAME, type AppConfig } from "./appconfig.ts";
import { installDesktopDirectoryPicker } from "./directory-picker.ts";
import { installDeveloperMenu } from "./developer-menu.ts";
import { resolveDshHome } from "./dshhome.ts";
import { DesktopHostProcess, type DesktopHostReady } from "./host-process.ts";
import { DESKTOP_IPC, DESKTOP_SCHEME_ARGUMENT, assertDesktopSender, desktopScheme } from "./ipc.ts";
import {} from "./profile-project.ts";
import { SEED_RUNTIME_DIR_NAME, ensureSeedProfile } from "./seed.ts";
import { installDesktopShortcuts } from "./shortcuts.ts";
import {
  DESKTOP_STREAM_PATH,
  encodeDesktopStreamItem,
  encodeDesktopStreamOpen,
} from "@morlay/dsh-desktop-host/wire";
import { shellWrappedSpawn } from "./shell-env.ts";

let focusPrimaryWindow = (): void => {};

// appconfig.json 的位置：打包形态只看 resources，dev 形态由 CLI 指到构建目录。
/** app 目录（dev 是装配目录、打包是 `Resources/app`）：由引导写进全局。 */
function shellRoot(): string {
  const root = globalThis.__DSH_SHELL_ROOT__;
  if (root === undefined || root === "") {
    throw new Error("dsh desktop: the shell root is missing (bootstrap did not report it)");
  }
  return root;
}

function appConfigDir(): string {
  const configured =
    developmentLayout() === undefined ? undefined : join(shellRoot(), "..", "runtime");
  return app.isPackaged || configured === undefined || configured === ""
    ? process.resourcesPath
    : configured;
}

function startupFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  void shellLog("入口失败或收尾失败 %o", error);
  void shellLog(`启动失败：${message}`);
  dialog.showErrorBox("dsh desktop startup failed", message);
  app.exit(1);
  throw error instanceof Error ? error : new Error(message);
}

// 配置与协议必须在 `ready` 之前定下（`registerSchemesAsPrivileged` 只有这一个窗口期）：
// Electron 会等入口模块的顶层 await 跑完才 emit `ready`，所以这里用 await 而不是同步 IO。
const appConfig: AppConfig = await loadAppConfig(appConfigDir()).catch((error: unknown) =>
  startupFailure(error),
);

// 自定义协议取自 app 名：与官方桌面应用（`dsh-app`）错开。
const SCHEME = ((): string => {
  try {
    return desktopScheme(appConfig.name);
  } catch (error) {
    startupFailure(error);
  }
})();

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

// Windows 自绘标题栏高度（DIP），与 preload 写入的 CSS 变量一致。
const WINDOWS_TITLEBAR_HEIGHT = 40;

interface RuntimeResources {
  readonly node: string;
  readonly runtime: string;
  readonly pnpm: string;
  readonly nodeBin: string;
  readonly seed: string;
  // 随包的 TS loader：源码面下 host 进程用它转译上游（`exports` 指 `src`），也交给它拉起的子进程。
  readonly loader: string;
}

/**
 * 打包形态下"当 node 用"的可执行文件。
 *
 * macOS 上 spawn 主二进制（`process.execPath`）会让系统**多出一个叫 `exec` 的 Dock 图标**——它落在 `.app`
 * 里、被当成 GUI 应用注册。改用同 bundle 的 **Helper**（它的 `Info.plist` 带 `LSUIElement`）就没有这个图标，
 * 而 `ELECTRON_RUN_AS_NODE` 对它一样生效。其余平台/形态直接用 `process.execPath`。
 * @returns 可执行文件的绝对路径。
 */
async function nodeExecutableOf(): Promise<string> {
  if (process.platform === "darwin") {
    const app = basename(process.execPath);
    const helper = join(
      dirname(process.execPath),
      "..",
      "Frameworks",
      `${app} Helper.app`,
      "Contents",
      "MacOS",
      `${app} Helper`,
    );
    if (await pathExistsOf(helper)) return helper;
  }
  return process.execPath;
}

async function runtimeResources(): Promise<RuntimeResources> {
  // 两种形态的"随包载荷"位置都能自己推出来：
  // - 打包：`Resources/{runtime,seed}`；
  // - dev：壳跑在装配目录 `<buildCache>/shell`，于是同级的 `../{runtime,seed}`——工具因此**不需要**把这些
  //   路径注入进来（dev 的宿主用系统 node，PATH 上就有）。
  const resourcesDir =
    developmentLayout() === undefined ? process.resourcesPath : join(shellRoot(), "..");
  // 宿主的 node：打包形态用 **Electron 的二进制**（上游同款：`main.ts` 的 `const node = process.execPath`
  // 与 `node-environment.ts` 的 `ELECTRON_RUN_AS_NODE`）。随包因此不再需要一份 node；而且宿主也能读 asar
  // （asar 补丁在 `ELECTRON_RUN_AS_NODE` 下照样生效）——app 才能整块打进 asar。dev 形态用系统 node。
  const node = developmentLayout() === undefined ? await nodeExecutableOf() : "node";
  const seed = join(resourcesDir, "seed");
  return {
    node,
    seed,
    // 随包运行时与 pnpm 只在打包产物里存在；dev 形态从工作区解析依赖。
    runtime:
      developmentLayout() === undefined
        ? join(resourcesDir, "runtime")
        : join(seed, SEED_RUNTIME_DIR_NAME),
    pnpm: join(resourcesDir, "runtime", "pnpm", "bin", "pnpm.mjs"),
    nodeBin: join(resourcesDir, "runtime", "bin"),
    // TS 运行时入口：**按路径取随包运行时里的那一份**（工具在备 runtime 时把 `@morlay/dsh-oxc-node` 的
    // `register.mjs` 连同它的依赖层拷进 `<runtime>/loader`）。壳因此**不依赖**那个包——依赖方向是
    // "devpackages → packages"，`@local/*` 不落到发布包的运行时依赖上。
    loader: join(resourcesDir, "runtime", "loader", "register.mjs"),
  };
}

// dev 形态的两格：profile root（app 目录本身）与安装根（官方闭包、前端产物与 host 载荷的来源）。
// 打包形态两格分别由 `$DSH_HOME/profiles/<name>` 与随包 runtime 给出。
interface DevelopmentLayout {
  readonly profileDir: string;
  readonly runtimeDir: string;
}

function configuredPath(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function developmentLayout(): DevelopmentLayout | undefined {
  const profileDir = configuredPath(process.env.DSH_DESKTOP_DEV_PROFILE_DIR);
  const runtimeDir = configuredPath(process.env.DSH_DESKTOP_DEV_RUNTIME_DIR);
  if (profileDir === undefined && runtimeDir === undefined) return undefined;
  if (app.isPackaged)
    throw new Error("dsh desktop: the development layout is unavailable in packaged applications");
  if (profileDir === undefined || runtimeDir === undefined)
    throw new Error(
      "dsh desktop: DSH_DESKTOP_DEV_PROFILE_DIR and DSH_DESKTOP_DEV_RUNTIME_DIR must be set together",
    );
  return { profileDir: resolve(profileDir), runtimeDir: resolve(runtimeDir) };
}

// 窗口形态：macOS 走 sidebar vibrancy + hiddenInset（交通灯落在侧边栏内），Windows 自绘 caption。
function windowFrame(): Pick<
  BrowserWindowConstructorOptions,
  | "titleBarStyle"
  | "frame"
  | "titleBarOverlay"
  | "trafficLightPosition"
  | "vibrancy"
  | "visualEffectState"
  | "backgroundColor"
> {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: "sidebar",
      // 'active' 让失焦时的材质稳定；'followWindow' 会把侧边栏洗白。
      visualEffectState: "active",
      backgroundColor: "#00000000",
    };
  }
  if (process.platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: {
        height: WINDOWS_TITLEBAR_HEIGHT,
        color: nativeTheme.shouldUseDarkColors ? "#1b1b1c" : "#f9fafb",
        symbolColor: nativeTheme.shouldUseDarkColors ? "#f9fafb" : "#0f1115",
      },
    };
  }
  return { frame: false };
}

function createWindow(
  preload: string,
  config: { width: number; height: number; minWidth: number; minHeight: number },
): BrowserWindowType {
  const window = new BrowserWindow({
    width: config.width,
    height: config.height,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    show: false,
    ...windowFrame(),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // preload 是 sandboxed 的（读不到文件），scheme 只能这样递进去。
      additionalArguments: [
        `${DESKTOP_SCHEME_ARGUMENT}=${SCHEME}`,
        // 页面把它当作 `ws://app/…` 的落点（见 preload 的 `__DSH_DESKTOP_WS__`）。
      ],
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const destination = new URL(url);
    if (destination.protocol !== `${SCHEME}:`) event.preventDefault();
  });
  return window;
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT;
  if (!enabled || configured === undefined || configured === "") return undefined;
  const port = Number(configured);
  // 0 也要放行：它表示"向系统要一个"（dshdev 的缺省就是 0，见 `debugPort`）。
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      "dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 0 through 65535",
    );
  }
  return port;
}

// host 进程自己那份转译器（绝对路径——host 的 cwd 是部署 / profile 目录，裸名在那儿解析不到）。
function sourceLoader(resources: RuntimeResources): string {
  return resources.loader;
}

// 拉起的子进程（上游 subprocess runner 等）走同一份转译器：它们按源码面加载上游入口，
// 而 argv 里的 `--import` 只有自己那份，所以要经环境把选择传下去。
function sourceLoaderEnvironment(path: string): Record<string, string> {
  return { DSH_SOURCE_LOADER: path };
}

/**
 * 壳的日志。
 *
 * 打包形态的 Electron **不把 `console` 写进 stdout**（它进系统日志），出了事只看到"窗口没起来"。
 * 所以壳自己的关键节点（启动、宿主就绪、fatal）落一份文件日志，与宿主那份（`${DSH_HOME}/logs/dev-host.log`，
 * 由 `@morlay/dsh-client-modules` 写）同目录，两边对着看就能定位"页面 → 壳 → 宿主"断在哪一段。
 */
async function shellLog(message: string, ...args: readonly unknown[]): Promise<void> {
  const home = resolveDshHome(appConfig) ?? join(process.cwd(), ".dsh-store");
  const file = join(home, "logs", "shell.log");
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${new Date().toISOString()} ${format(message, ...args)}\n`, "utf8");
  } catch {
    // 记不下来就算了：这里已在异常路径上，不该再抛。
  }
}

/** 文件在不在（项目禁同步 IO）。 */
async function pathExistsOf(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function main(): Promise<void> {
  const development = developmentLayout();
  const resources = await runtimeResources();
  const hostInspectPort = developmentHostInspectPort(development !== undefined);
  const profileDir =
    development?.profileDir ?? join(resolveDshHome(appConfig) ?? "", "profiles", PROFILE_NAME);

  const runtimeDir = development?.runtimeDir ?? resources.runtime;
  const dataDir = resolveDshHome(appConfig);
  // bundles 的真值在 profile 的清单里（`dsh.profile.bundles`）——壳不持有这份列表，读一次只为日志。
  const bundleCount = await readFile(join(profileDir, "package.json"), "utf8")
    .then(
      (text) =>
        (JSON.parse(text) as { dsh?: { profile?: { bundles?: unknown[] } } }).dsh?.profile?.bundles
          ?.length,
    )
    .catch(() => undefined);
  // **一行说清启动面**：形态 / 根 / profileDir / 数据面 / bundles 数。打包形态出问题（profile 路径、
  // bundle 配置没生效、少服务）时，这一行就是第一现场——以前只有"形态 + 根"，路径对不对全靠猜。
  await shellLog(
    `启动：形态=${development === undefined ? "bundle" : "dev"} root=${globalThis.__DSH_SHELL_ROOT__ ?? "(未知)"} ` +
      `profileDir=${profileDir} dataDir=${dataDir ?? "(未解析)"} dataDirSpec=${appConfig.dataDir} ` +
      `bundles=${String(bundleCount)}`,
  );

  if (development === undefined) {
    if (dataDir === undefined)
      throw new Error("dsh desktop: packaged applications require a concrete dataDir");
    // **先完整种好 profile 再起宿主**：`ensureSeedProfile` 返回时，清单与依赖面（随包归档解压出来的
    // 实体闭包）都已就位——它自己会校验"依赖面是否真的落地"，缺了就当场抛。"种了什么"也要看得见：
    // 打包形态的 profile 出了问题（组件不完整之类）第一件事就是看这一行。随包没有那份种则是致命的：
    // 那说明产物本身就缺件，不能带着空 profile 硬起。
    const seeded = await ensureSeedProfile(resources.seed, dataDir);
    if (seeded === "no-seed") {
      throw new Error(
        `dsh desktop: the packaged app carries no ${PROFILE_NAME} profile seed at ${resources.seed}`,
      );
    }
    await shellLog(`profile 种子：${seeded === "seeded" ? "已重种" : "已是最新"}`);
  }
  // **两种形态都不要求上游的前端静态产物**：页面与资源由这条链（vite + 联邦预编译，见
  // `@morlay/dsh-client-modules`）在宿主进程里现场提供，壳只是把请求经字节管道交给它。所以这里不再检查
  // `@deepseek-ai/dsh-web-frontend/dist`——profile 的 `dsh.profile.bundles` 声明了那条链，就不该再要求它。

  let host: DesktopHostProcess | undefined;
  let mainWindow: BrowserWindowType | undefined;
  let quitConfirmed = false;
  let quitPrompting = false;
  /** preload 落盘的位置：字节由宿主现场打包（sandboxed preload 只能是 CJS），这里只是放它。 */
  const preloadPathOf = (): string => join(app.getPath("userData"), "preload-app.cjs");

  // 只有打包形态拦一次确认（开发形态关窗即退出）。
  const confirmQuit = async (window?: BrowserWindowType): Promise<void> => {
    if (quitPrompting) return;
    quitPrompting = true;
    try {
      const options = {
        type: "question" as const,
        buttons: ["Cancel", "Quit"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: `Quit ${appConfig.displayName}?`,
        detail: "The desktop backend and its running sessions will stop.",
      };
      const parent = window ?? mainWindow;
      const { response } =
        parent === undefined || parent.isDestroyed()
          ? await dialog.showMessageBox(options)
          : await dialog.showMessageBox(parent, options);
      if (response !== 1) return;
      quitConfirmed = true;
      app.quit();
    } finally {
      quitPrompting = false;
    }
  };

  let hostFailureHandled = false;
  // 底层服务挂掉后请求只会拿到 503；这里直接拦截：报出原因并退出，不让页面停在半死状态。
  const handleHostFailure = (error: Error): void => {
    if (hostFailureHandled) return;
    hostFailureHandled = true;
    void shellLog(`后端停止：${error.message}`);
    void shellLog(`宿主停止：${error.message}`);
    dialog.showErrorBox("dsh desktop backend stopped", error.message);
    quitConfirmed = true;
    app.exit(1);
  };

  const startHost = async (
    target: string = profileDir,
  ): Promise<{ process: DesktopHostProcess; ready: DesktopHostReady }> => {
    const loader = sourceLoader(resources);
    const next = new DesktopHostProcess(resources.node, runtimeDir, target, hostInspectPort, {
      nodeArgs: [`--import=${loader}`],
      // 宿主输出落盘：打包形态 GUI 里看不到它的 stdout/stderr，而"少服务/某个 bundle 没起来"的原因就在那里。
      logFile: join(dataDir ?? join(process.cwd(), ".dsh-store"), "logs", "host.log"),
      // 宿主入口一律按 node 的解析取**源码**（`@morlay/dsh-desktop-host` 的 exports 指 `src/index.ts`，
      // 由上面的 loader 转译）：两种形态同一条路，部署里不必再落一份 dist 载荷。
      //
      // 解析基准是**壳自己**：`@morlay/dsh-desktop-host` 是壳的依赖（打包后落在 `Resources/app/node_modules`
      // 里）。以前这里以**运行时根**为基准（`Resources/runtime/index.js`），能解析只是因为 runtime 里还留着一份
      // 重复的闭包——runtime 现在只放工具链（node / pnpm / loader），依赖面在壳与 profile 各自那一份里。
      // 宿主入口：两种形态都从壳自己的解析面取（打包形态落在 `Resources/app/node_modules` 里，进 asar）。
      // 宿主跑的就是 Electron 的 node（见上面 `node` 与 `ELECTRON_RUN_AS_NODE`），asar 补丁因此对它生效，
      // 入口与其依赖树都能留在 asar 内——只有 native（`*.node`）必须 unpack 出来。
      entry: createRequire(import.meta.url).resolve(DESKTOP_HOST_PACKAGE),

      extraEnv: {
        // 宿主进程的"node"是 Electron 二进制：这个开关让它当 node 用（上游 `node-environment.ts` 同款）。
        ELECTRON_RUN_AS_NODE: "1",
        ...(dataDir === undefined ? {} : { DSH_HOME: dataDir }),
        // 宿主按它现场打包 preload（见 `@morlay/dsh-desktop-host/preload-source`）。
        ...(globalThis.__DSH_SHELL_ROOT__ === undefined
          ? {}
          : { DSH_DESKTOP_SHELL_ROOT: globalThis.__DSH_SHELL_ROOT__ }),
        // 形态标志：壳起宿主时会过滤掉所有 `DSH_DESKTOP_*`（那些是 Electron 侧的元数据），所以这条链要
        // 判断"跑在桌面形态里"得用别的名字（前端资源的预编译策略据此分流）。
        DSH_DEV_FORM: "desktop",
        // 这条链是 fs / 哈希密集的（预编译按包读源码、算指纹、写产物 + vite 的转译），这些全走 libuv 线程池，
        // 默认只有 4：并发一多请求就排在池子外。bundle 形态不经过 `dshdev`，所以这里也设一份。
        UV_THREADPOOL_SIZE: process.env["UV_THREADPOOL_SIZE"] ?? "64",
        ...(development === undefined ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...sourceLoaderEnvironment(loader),
      },
      // `ps` 里能把后端与别的 node 进程区分开。
      processTitle: `${appConfig.name}-server`,
      // 打包形态的包操作使用随包 pnpm；dev 形态回退到 PATH 上的 pnpm。
      ...(development === undefined
        ? { packageManager: { pnpm: resources.pnpm, nodeBin: resources.nodeBin } }
        : {}),
      spawn: shellWrappedSpawn,
      onFailure: handleHostFailure,
    });
    const ready = await next.start();
    return { process: next, ready };
  };

  // 应用页面的全部请求（文档、资源、插件 bundle、API、流）都经字节管道交给宿主进程内的 webServer。
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response(null, { status: 404 });
    const active = host;
    if (active === undefined) return new Response("backend unavailable", { status: 503 });
    if (!app.isPackaged) void shellLog(`recv ${request.method} ${url.pathname}`);
    // **去掉条件请求头**：宿主的响应要包成 Fetch `Response`，而它不接受 304（`Invalid response status
    // code 304`）——vite 对源码模块正是回 304 的（`/@vite/client`、`/index.ts` 那些），于是每次刷新都在
    // 这里抛错。不带条件头，服务端就只会回 200（这条链的产物也不大，不值得为 304 冒这个险）。
    const conditional = new Request(request.url, {
      method: request.method,
      headers: [...request.headers].filter(
        ([name]) => name !== "if-none-match" && name !== "if-modified-since",
      ),
      ...(request.body === null ? {} : { body: request.body, duplex: "half" }),
    });
    const response = await active.fetch(conditional);
    // dev 形态打印每个应用请求：排查「页面 → 壳 → 宿主」断在哪一段。
    if (!app.isPackaged)
      void shellLog(`${request.method} ${url.pathname} → ${String(response.status)}`);
    return response;
  });

  installDesktopDirectoryPicker(() => mainWindow, () => hostOrigin);

  // 桌面流载体：主进程自己构造 Request（body 是流——首行定 endpoint/payload，后续行是上行项），
  // 把响应体逐块推回页面——页面 fetch 到自定义协议的 POST body 在 Chromium 上不可靠。
  let nextStreamId = 1;
  const streamEncoder = new TextEncoder();
  interface ActiveStream {
    readonly abort: AbortController;
    // 宿主请求体的写端；上行结束或取消后置空。
    uplink: ReadableStreamDefaultController<Uint8Array> | undefined;
  }
  const activeStreams = new Map<number, ActiveStream>();
  // 结束宿主请求体：已取消/已结束的流上 close 会抛，这里只当收尾。
  const closeStreamUplink = (stream: ActiveStream): void => {
    const uplink = stream.uplink;
    if (uplink === undefined) return;
    stream.uplink = undefined;
    try {
      uplink.close();
    } catch (error) {
      if (!app.isPackaged) void shellLog("stream uplink close failed %o", error);
    }
  };
  ipcMain.handle(DESKTOP_IPC.streamOpen, async (event, endpoint: unknown, payload: unknown) => {
    assertDesktopSender(event, [hostOrigin]);
    if (typeof endpoint !== "string") throw new Error("dsh desktop: stream endpoint must be text");
    const active = host;
    if (active === undefined) throw new Error("dsh desktop: Host is unavailable");
    if (!app.isPackaged) void shellLog(`stream open ${endpoint}`);
    const id = nextStreamId++;
    const abort = new AbortController();
    const stream: ActiveStream = { abort, uplink: undefined };
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        stream.uplink = controller;
        controller.enqueue(streamEncoder.encode(encodeDesktopStreamOpen(endpoint, payload)));
      },
      cancel: () => {
        stream.uplink = undefined;
      },
    });
    activeStreams.set(id, stream);
    const request = new Request(`http://127.0.0.1${DESKTOP_STREAM_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: abort.signal,
      duplex: "half",
    } as RequestInit);
    void (async () => {
      try {
        const response = await active.fetch(request);
        if (!app.isPackaged) void shellLog(`stream ${endpoint} → ${String(response.status)}`);
        event.sender.send(DESKTOP_IPC.streamChunk, { id, status: response.status });
        if (response.body === null) {
          event.sender.send(DESKTOP_IPC.streamEnd, { id });
          return;
        }
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          event.sender.send(DESKTOP_IPC.streamChunk, { id, data: decoder.decode(chunk) });
        }
        event.sender.send(DESKTOP_IPC.streamEnd, { id });
      } catch (error) {
        event.sender.send(DESKTOP_IPC.streamError, {
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // 流结束（或出错）时上行若还开着就收尾：宿主那边不必等一个不会再来的 end。
        closeStreamUplink(stream);
        activeStreams.delete(id);
      }
    })();
    return id;
  });
  ipcMain.on(DESKTOP_IPC.streamCancel, (event, id: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
    if (typeof id !== "number") return;
    activeStreams.get(id)?.abort.abort();
  });
  // 上行项与上行结束都写成宿主请求体的行：请求体的 end 让宿主侧的 uplink 迭代结束。
  ipcMain.on(DESKTOP_IPC.streamUplink, (event, id: unknown, item: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
    if (typeof id !== "number") return;
    const uplink = activeStreams.get(id)?.uplink;
    if (uplink === undefined) return;
    try {
      uplink.enqueue(streamEncoder.encode(encodeDesktopStreamItem(item)));
    } catch (error) {
      if (!app.isPackaged) void shellLog("stream uplink rejected %o", error);
    }
  });
  ipcMain.on(DESKTOP_IPC.streamUplinkEnd, (event, id: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
    if (typeof id !== "number") return;
    const stream = activeStreams.get(id);
    if (stream === undefined) return;
    closeStreamUplink(stream);
  });

  // 只有主窗口可以把自己的配色同步给原生材质。
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
    if (source === "light" || source === "dark" || source === "system")
      nativeTheme.themeSource = source;
  });

  // 上游 @deepseek-ai/dsh-client-shortcuts 在桌面运行时要求 window.dshDesktop.keyboard：
  // 这里装上原生侧（设备偏好 + 按键转发），preload 负责按那份契约暴露给页面。
  const shortcuts = installDesktopShortcuts(
    () => mainWindow,
    app.getPath("userData"),
    process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
    () => hostOrigin,
  );
  app.on("will-quit", () => {
    shortcuts.dispose();
  });

  /** 宿主回环的 ws 端口：宿主起好之后填入（窗口重建时仍用它）。 */
  // 窗口载入的地址：宿主 webServer 的 origin（`http://127.0.0.1:<port>`）。以前是自定义协议
  // `dsh-custom-next://app/`——那条路没有 origin，settings 的 describe 流等长连接拿不到答复。
  let hostOrigin = "";
  let appPreload = preloadPathOf();
  const createMainWindow = (): BrowserWindowType => {
    const window = createWindow(appPreload, appConfig.window);
    mainWindow = window;
    shortcuts.attach(window);
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });
    window.on("close", (event) => {
      if (!app.isPackaged || quitConfirmed) return;
      event.preventDefault();
      void confirmQuit(window);
    });
    window.on("closed", () => {
      if (mainWindow === window) mainWindow = undefined;
    });
    return window;
  };
  focusPrimaryWindow = () => {
    const window = mainWindow;
    if (window === undefined || window.isDestroyed()) {
      const replacement = createMainWindow();
      void replacement.loadURL(hostOrigin);
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  // 后端调试面：View 菜单里的 Node inspector 开关，端点在需要时才开（决策见 .agents/adrs）。
  const developerMenu = installDeveloperMenu({
    scheme: SCHEME,
    appName: appConfig.displayName,
    host: () => host,
    mainWindow: () => mainWindow,
  });
  app.on("will-quit", () => {
    developerMenu.dispose();
  });

  const started = await startHost();
  host = started.process;
  hostOrigin = started.ready.origin;
  // preload 的字节由宿主机现场打包（sandboxed preload 只能 CJS，也挂不了 hooks）：取回来落到用户数据目录，
  // 再把路径交给窗口——装配目录里因此没有预产的 `dist/`。
  appPreload = preloadPathOf();
  // 直连宿主的真 webServer 取它（`installPreloadSource` 把这条路由注册在它上面）。以前走自定义协议 →
  // 字节管道，而那条路已经不通向 webServer 了（页面改从 origin 载入之后，管道不再承载请求）。
  const preload = await fetch(new Request(`${hostOrigin}${PRELOAD_SOURCE_PATH}`));
  if (!preload.ok) {
    throw new Error(
      `dsh desktop: preload bundling failed (${String(preload.status)}): ${await preload.text()}`,
    );
  }
  await writeFile(appPreload, await preload.text(), "utf8");

  mainWindow = createMainWindow();
  await mainWindow.loadURL(hostOrigin);
  if (development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== "0") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow();
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", (event) => {
    if (app.isPackaged && !quitConfirmed) {
      event.preventDefault();
      void confirmQuit();
      return;
    }
    if (host === undefined) return;
    event.preventDefault();
    const active = host;
    host = undefined;
    void active
      .stop()
      .catch((error: unknown) => {
        void shellLog("入口失败或收尾失败 %o", error);
      })
      .finally(() => {
        app.quit();
      });
  });
}

if (app.isPackaged) {
  try {
    // 打包应用必须在 whenReady 之前把 userData 指到 appconfig.json 的 id 目录。
    const profile = join(app.getPath("appData"), appConfig.id);
    await mkdir(profile, { recursive: true });
    app.setPath("userData", profile);
  } catch (error) {
    void shellLog("入口失败或收尾失败 %o", error);
  }
}

const ownsDesktopInstance = ((): boolean => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", () => {
    focusPrimaryWindow();
  });
  return true;
})();

if (ownsDesktopInstance)
  void app
    .whenReady()
    .then(main)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      void shellLog("入口失败或收尾失败 %o", error);
      const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE;
      if (diagnosticFile !== undefined) {
        await import("node:fs/promises")
          .then((fs) =>
            fs.writeFile(
              diagnosticFile,
              `${error instanceof Error ? (error.stack ?? message) : message}\n`,
            ),
          )
          .catch(() => undefined);
      }
      dialog.showErrorBox("dsh desktop startup failed", message);
      app.exit(1);
    });
