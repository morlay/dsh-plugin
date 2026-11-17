// 内嵌浏览器面板的 **Electron 适配器**：`WebContentsView` + 独立 session 分区 + 权限全拒 + 无 preload。
//
// 权限面全在这里，而且是**默认拒绝**：面板里的页面是外网内容，它不该拿到摄像头、通知、剪贴板、下载，
// 也不该有 preload（壳的桥一个都不给）。要开口子必须按 origin 单独加，不是在这里留通用开关。
import type { BrowserPanePort, PaneOpenInput, PaneRect, PaneState } from "./browser-pane.ts";
import { browserUrlAllowed } from "./browser-url.ts";

/** 面板的 session 分区名：**持久化**的独立命名空间，与主页面互不可见。 */
export const BROWSER_PANE_PARTITION = "persist:zephyr-browser";

/** 面板 view 的 `webPreferences`（壳只给这几项，且**没有** preload）。 */
export interface BrowserPaneWebPreferences {
  readonly partition: string;
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
}

/** 面板 view 的 webContents（壳只用到这些成员）。 */
export interface BrowserPaneWebContentsLike {
  loadURL(url: string): Promise<void>;
  close(): void;
  isDestroyed(): boolean;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  isLoading(): boolean;
  on(event: string, listener: (...args: never[]) => void): void;
  setWindowOpenHandler(
    handler: (details: { readonly url: string }) => { readonly action: string },
  ): void;
}

/** 一个面板 view（Electron `WebContentsView` 的子集）。 */
export interface BrowserPaneViewLike {
  readonly webContents: BrowserPaneWebContentsLike;
  setBounds(bounds: PaneRect): void;
}

/** 面板用到的 Electron 面（窄到只够这个适配器：假件也好写）。 */
export interface BrowserPaneElectronLike {
  readonly WebContentsView: new (options: {
    readonly webPreferences: BrowserPaneWebPreferences;
  }) => BrowserPaneViewLike;
  readonly session: {
    fromPartition(partition: string): BrowserPaneSessionLike;
  };
}

/** 分区上的两个权限钩子（下载另走 `will-download`）。 */
export interface BrowserPaneSessionLike {
  setPermissionRequestHandler(
    handler: (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string, origin: string) => boolean): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

/** 面板挂在窗口的哪一层（`contentView` 的子 view 列表）。 */
export interface BrowserPaneHostLike {
  add(view: BrowserPaneViewLike): void;
  remove(view: BrowserPaneViewLike): void;
}

/**
 * @returns 权限请求处理器：**一律拒绝**。
 */
export function panePermissionRequestHandlerOf(): (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void {
  return (_contents, _permission, callback) => {
    callback(false);
  };
}

/**
 * @returns 权限检查处理器：**一律判假**（`navigator.permissions.query` 因此拿不到 granted）。
 */
export function panePermissionCheckHandlerOf(): (
  contents: unknown,
  permission: string,
  origin: string,
) => boolean {
  return () => false;
}

/** 面板 view 的 webPreferences（**没有** preload 是有意的：面板拿不到壳的桥）。 */
const PANE_WEB_PREFERENCES: BrowserPaneWebPreferences = {
  partition: BROWSER_PANE_PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
};

/**
 * 造 Electron 适配器。
 * @param input - electron 面与把 view 挂到窗口上的那两下。
 * @returns 接缝（判据不在这里：协议白名单在 `browser-pane.ts` 的路由上）。
 */
export function webContentsPaneViewOf(input: {
  readonly electron: BrowserPaneElectronLike;
  readonly host: BrowserPaneHostLike;
  /** 状态变了（url / title / loading）：**只**由主进程推给渲染进程，渲染侧不自己推导。 */
  readonly onChange?: (id: string) => void;
  /** 页面要开新窗口（`target=_blank` 或脚本）：http(s) 交系统浏览器，其余丢弃。 */
  readonly openExternal?: (url: string) => void;
}): BrowserPanePort {
  const panes = new Map<string, BrowserPaneViewLike>();
  const configure = (): BrowserPaneSessionLike => {
    const session = input.electron.session.fromPartition(BROWSER_PANE_PARTITION);
    session.setPermissionRequestHandler(panePermissionRequestHandlerOf());
    session.setPermissionCheckHandler(panePermissionCheckHandlerOf());
    // 下载一律取消：面板是「看网页」，不是「往磁盘落东西」。
    session.on("will-download", (...args: never[]) => {
      // `never[]` 是自定最小面里的兜底签名：首参在真 Electron 里是下载事件，单断言就够（`never` 可收窄到
      // 任意类型），不必绕 `as unknown as`（那是双断言，audit 白名单只给边界桥）。
      const event = args[0] as { preventDefault(): void } | undefined;
      event?.preventDefault();
    });
    return session;
  };
  configure();
  return {
    get opened(): readonly string[] {
      return [...panes.keys()];
    },
    async open(request: PaneOpenInput): Promise<void> {
      if (panes.has(request.id)) return;
      const view = new input.electron.WebContentsView({ webPreferences: PANE_WEB_PREFERENCES });
      view.setBounds(request.bounds);
      // 状态的四条来源：导航完成、标题变化、加载起止。都只做一件事——提醒调用方推一次 state。
      const changed = (): void => input.onChange?.(request.id);
      for (const event of ["did-navigate", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
        view.webContents.on(event, changed);
      }
      // 页面要开新窗口：http(s) 交**系统浏览器**（与主窗口同一条处置），然后一律拒——面板只有一块。
      view.webContents.setWindowOpenHandler((details) => {
        if (browserUrlAllowed(details.url)) input.openExternal?.(details.url);
        return { action: "deny" };
      });
      panes.set(request.id, view);
      input.host.add(view);
      if (request.url !== undefined && request.url !== "") await view.webContents.loadURL(request.url);
    },
    setBounds(id: string, bounds: PaneRect): void {
      panes.get(id)?.setBounds(bounds);
    },
    async navigate(id: string, url: string): Promise<void> {
      const view = panes.get(id);
      if (view === undefined) return;
      await view.webContents.loadURL(url);
    },
    async close(id: string): Promise<void> {
      const view = panes.get(id);
      if (view === undefined) return;
      panes.delete(id);
      input.host.remove(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },
    state(id: string): PaneState | undefined {
      const view = panes.get(id);
      if (view === undefined) return undefined;
      return {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        canGoBack: view.webContents.canGoBack(),
        loading: view.webContents.isLoading(),
      };
    },
  };
}
