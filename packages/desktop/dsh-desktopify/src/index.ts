import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import { loadAppConfig, PROFILE_NAME, type AppConfig } from "./appconfig.ts";
import { installDesktopDirectoryPicker } from "./directory-picker.ts";
import { resolveDshHome } from "./dshhome.ts";
import { DesktopHostProcess } from "./host-process.ts";
import { DESKTOP_IPC, DESKTOP_SCHEME_ARGUMENT, assertDesktopSender, desktopScheme } from "./ipc.ts";
import {
  PROFILE_WORKSPACE_NAME,
  installProfile,
  runtimeOverrides,
  workspaceWithOverrides,
} from "./profile-project.ts";
import { SEED_RUNTIME_DIR_NAME, ensureSeedProfile } from "./seed.ts";
import { DESKTOP_STREAM_PATH } from "@morlay/dsh-desktop-host/wire";
import { shellWrappedSpawn } from "./shell-env.ts";

let focusPrimaryWindow = (): void => {};

/** appconfig.json 的位置：打包形态只看 resources，dev 形态由 CLI 指到构建目录。 */
function appConfigDir(): string {
  const configured = process.env.DSH_DESKTOP_APPCONFIG_DIR;
  return app.isPackaged || configured === undefined || configured === ""
    ? process.resourcesPath
    : configured;
}

function startupFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  dialog.showErrorBox("dsh desktop startup failed", message);
  app.exit(1);
  throw error instanceof Error ? error : new Error(message);
}

// 配置与协议必须在 `ready` 之前定下（`registerSchemesAsPrivileged` 只有这一个窗口期）：
// Electron 会等入口模块的顶层 await 跑完才 emit `ready`，所以这里用 await 而不是同步 IO。
const appConfig: AppConfig = await loadAppConfig(appConfigDir()).catch((error: unknown) =>
  startupFailure(error),
);

/** 自定义协议取自 app 名：与官方桌面应用（`dsh-app`）错开。 */
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

const WEB_FRONTEND_PACKAGE = "@deepseek-ai/dsh-web-frontend";

const APPLICATION_URL = `${SCHEME}://app/`;

/** Windows 自绘标题栏高度（DIP），与 preload 写入的 CSS 变量一致。 */
const WINDOWS_TITLEBAR_HEIGHT = 40;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface RuntimeResources {
  readonly node: string;
  readonly runtime: string;
  readonly pnpm: string;
  readonly nodeBin: string;
  readonly seed: string;
  readonly primaryRuntime: string;
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged;
  const node =
    (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined) ??
    join(
      process.resourcesPath,
      "runtime",
      "node",
      process.platform === "win32" ? "node.exe" : "node",
    );
  const seed =
    (development ? process.env.DSH_DESKTOP_SEED_DIR : undefined) ??
    join(process.resourcesPath, "seed");
  const configured = process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR;
  const primaryRuntime =
    configured !== undefined && configured !== ""
      ? resolve(configured)
      : join(process.resourcesPath, "runtime", "primary-runtime");
  return {
    node,
    seed,
    primaryRuntime,
    // 随包运行时与 pnpm 只在打包产物里存在；dev 形态从工作区解析依赖。
    runtime: join(seed, SEED_RUNTIME_DIR_NAME),
    pnpm: join(process.resourcesPath, "runtime", "pnpm", "bin", "pnpm.mjs"),
    nodeBin: join(process.resourcesPath, "runtime", "bin"),
  };
}

async function installPlantedProfile(
  profileDir: string,
  resources: RuntimeResources,
): Promise<void> {
  const settingsPath = join(profileDir, PROFILE_WORKSPACE_NAME);
  const overrides = await runtimeOverrides(profileDir, resources.runtime);
  await writeFile(
    settingsPath,
    workspaceWithOverrides(await readFile(settingsPath, "utf8"), overrides),
  );
  await installProfile({
    node: resources.node,
    pnpmEntry: resources.pnpm,
    profileDir,
  });
}

function developmentProject(): string | undefined {
  const configured = process.env.DSH_DESKTOP_DEV_PROJECT_DIR;
  if (configured === undefined || configured === "") return undefined;
  if (app.isPackaged)
    throw new Error(
      "dsh desktop: development project override is unavailable in packaged applications",
    );
  return resolve(configured);
}

/** 窗口形态：macOS 走 sidebar vibrancy + hiddenInset（交通灯落在侧边栏内），Windows 自绘 caption。 */
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
): BrowserWindow {
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
      additionalArguments: [`${DESKTOP_SCHEME_ARGUMENT}=${SCHEME}`],
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
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535",
    );
  }
  return port;
}

function developmentNodeArgs(): string[] {
  const specifier = process.env.DSH_DESKTOP_TSX_IMPORT;
  return specifier === undefined || specifier === "" ? [] : [`--import=${specifier}`];
}

async function main(): Promise<void> {
  const development = developmentProject();
  const resources = runtimeResources();
  const hostInspectPort = developmentHostInspectPort(development !== undefined);
  const activeProject =
    development ?? join(resolveDshHome(appConfig) ?? "", "profiles", PROFILE_NAME);

  const runtimeProject = development ?? resources.runtime;
  const webDocumentRoot = join(
    runtimeProject,
    "node_modules",
    ...WEB_FRONTEND_PACKAGE.split("/"),
    "dist",
  );
  const dshHome = resolveDshHome(appConfig);

  if (development === undefined) {
    if (dshHome === undefined)
      throw new Error("dsh desktop: packaged applications require a concrete dshHome");
    if (await ensureSeedProfile(resources.seed, dshHome)) {
      await installPlantedProfile(activeProject, resources);
    }
  }
  if (!(await pathExists(join(webDocumentRoot, "index.html")))) {
    throw new Error(
      `dsh desktop: the Web frontend is missing at ${webDocumentRoot}; ` +
        `the runtime closure must carry ${WEB_FRONTEND_PACKAGE}`,
    );
  }

  let host: DesktopHostProcess | undefined;
  let mainWindow: BrowserWindow | undefined;
  let quitConfirmed = false;
  let quitPrompting = false;
  const appPreload = fileURLToPath(new URL("./preload-app.cjs", import.meta.url));

  // 只有打包形态拦一次确认（开发形态关窗即退出）。
  const confirmQuit = async (window?: BrowserWindow): Promise<void> => {
    if (quitPrompting) return;
    quitPrompting = true;
    try {
      const options = {
        type: "question" as const,
        buttons: ["Cancel", "Quit"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: `Quit ${appConfig.name}?`,
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
    console.error(`[dsh-shell] backend stopped: ${error.message}`);
    dialog.showErrorBox("dsh desktop backend stopped", error.message);
    quitConfirmed = true;
    app.exit(1);
  };

  const startHost = async (projectDir = activeProject): Promise<DesktopHostProcess> => {
    const next = new DesktopHostProcess(
      resources.node,
      runtimeProject,
      projectDir,
      hostInspectPort,
      {
        nodeArgs: development === undefined ? [] : developmentNodeArgs(),

        extraEnv: {
          ...(dshHome === undefined ? {} : { DSH_HOME: dshHome }),
          ...(development === undefined ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
        },
        primaryRuntime: resources.primaryRuntime,
        // `ps` 里能把后端与别的 node 进程区分开。
        processTitle: `${appConfig.name}-server`,
        // 打包形态的包操作使用随包 pnpm；dev 形态回退到 PATH 上的 pnpm。
        ...(development === undefined
          ? { packageManager: { pnpm: resources.pnpm, nodeBin: resources.nodeBin } }
          : {}),
        spawn: shellWrappedSpawn,
        onFailure: handleHostFailure,
      },
    );
    await next.start();
    return next;
  };

  // 应用页面的全部请求（文档、资源、插件 bundle、API、流）都经字节管道交给宿主进程内的 webServer。
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response(null, { status: 404 });
    const active = host;
    if (active === undefined) return new Response("backend unavailable", { status: 503 });
    if (!app.isPackaged) console.error(`[dsh-shell] recv ${request.method} ${url.pathname}`);
    const response = await active.fetch(request);
    // dev 形态打印每个应用请求：排查「页面 → 壳 → 宿主」断在哪一段。
    if (!app.isPackaged)
      console.error(`[dsh-shell] ${request.method} ${url.pathname} → ${String(response.status)}`);
    return response;
  });

  installDesktopDirectoryPicker(() => mainWindow, SCHEME);

  // 桌面流载体：主进程自己构造 Request（body 是普通字符串流，宿主能正常读完），
  // 把响应体逐块推回页面——页面 fetch 到自定义协议的 POST body 在 Chromium 上不可靠。
  let nextStreamId = 1;
  const activeStreams = new Map<number, AbortController>();
  ipcMain.handle(DESKTOP_IPC.streamOpen, async (event, endpoint: unknown, payload: unknown) => {
    assertDesktopSender(event, SCHEME, ["app"]);
    if (typeof endpoint !== "string") throw new Error("dsh desktop: stream endpoint must be text");
    const active = host;
    if (active === undefined) throw new Error("dsh desktop: Host is unavailable");
    if (!app.isPackaged) console.error(`[dsh-shell] stream open ${endpoint}`);
    const id = nextStreamId++;
    const abort = new AbortController();
    activeStreams.set(id, abort);
    const request = new Request(`http://127.0.0.1${DESKTOP_STREAM_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, payload }),
      signal: abort.signal,
    });
    void (async () => {
      try {
        const response = await active.fetch(request);
        if (!app.isPackaged)
          console.error(`[dsh-shell] stream ${endpoint} → ${String(response.status)}`);
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
        activeStreams.delete(id);
      }
    })();
    return id;
  });
  ipcMain.on(DESKTOP_IPC.streamCancel, (event, id: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
    if (typeof id !== "number") return;
    activeStreams.get(id)?.abort();
  });

  // 只有主窗口可以把自己的配色同步给原生材质。
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
    if (source === "light" || source === "dark" || source === "system")
      nativeTheme.themeSource = source;
  });

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, appConfig.window);
    mainWindow = window;
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
      void replacement.loadURL(APPLICATION_URL);
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  host = await startHost();

  mainWindow = createMainWindow();
  await mainWindow.loadURL(APPLICATION_URL);
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
        console.error(error);
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
    console.error(error);
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
      console.error(error);
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
