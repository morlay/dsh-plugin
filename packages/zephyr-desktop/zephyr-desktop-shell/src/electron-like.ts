// 壳对 `electron` 的最小声明面：**壳不静态依赖 electron 的类型**（它是可选 peer，也只在 Electron 里存在）。
//
// 新增原生能力时先在这里加成员：能加到这里，就说明壳只用到了这个面。
import type { WorkArea, WindowBounds } from "./window-state.ts";

/** 一个窗口（`BrowserWindow` 的子集）。 */
export interface ElectronWindow {
  loadURL(url: string): Promise<void>;
  once(event: string, listener: () => void): void;
  on(event: string, listener: (...args: never[]) => void): void;
  show(): void;
  close(): void;
  focus(): void;
  restore(): void;
  maximize(): void;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isMaximized(): boolean;
  isFocused(): boolean;
  isEnabled(): boolean;
  /** 最大化之前的矩形（关窗时存它，下次才能回到用户拖动出来的尺寸）。 */
  getNormalBounds(): WindowBounds;
  /** 这个 webContents id 是不是本窗口的（IPC 的准入判据）。 */
  owns(senderId: number): boolean;
  readonly webContents: ElectronWebContents;
}

/** 窗口里的渲染进程（壳只用到这几处）。 */
export interface ElectronWebContents {
  readonly id: number;
  on(event: string, listener: (...args: never[]) => void): void;
  openDevTools(options?: { mode?: string }): void;
  send(channel: string, ...args: unknown[]): void;
  /** 录制快捷键时把菜单快捷键让给页面。 */
  setIgnoreMenuShortcuts(ignore: boolean): void;
  /** 页面要开新窗口时的裁决（壳一律拒：桌面形态只有一扇窗）。 */
  setWindowOpenHandler(
    handler: (details: { readonly url: string }) => { readonly action: string },
  ): void;
}

/** Electron 模块的最小面。 */
export interface ElectronLike {
  readonly app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: never[]) => void): void;
    quit(): void;
    /** 单实例锁：拿不到就说明已经有同名 userData 的实例在跑。 */
    requestSingleInstanceLock(): boolean;
    commandLine: { appendSwitch(name: string, value?: string): void };
    setPath(name: string, path: string): void;
    getPath(name: string): string;
    /** 应用名（`package.json` 的 `name`）：没有 `desktop.id` 时用它当数据目录名。 */
    getName(): string;
    disableHardwareAcceleration(): void;
  };
  readonly BrowserWindow: new (options: unknown) => ElectronWindow;
  readonly dialog: {
    showOpenDialog(
      window: unknown,
      options: unknown,
    ): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
  };
  readonly ipcMain: {
    /** 渲染进程的 invoke：`event.senderId` 是发起方的 webContents id（IPC 的准入判据）。 */
    handle(
      channel: string,
      listener: (event: { readonly senderId?: number }, ...args: unknown[]) => Promise<unknown>,
    ): void;
  };
  /** 显示器：只用主屏的可用区域（窗口状态要在启动时夹回可见范围）。 */
  readonly screen: {
    getPrimaryDisplay(): { readonly workArea: WorkArea };
  };
  /** 应用菜单（产品菜单模板在 `menu.ts`）。 */
  readonly Menu: {
    buildFromTemplate(template: readonly unknown[]): unknown;
    setApplicationMenu(menu: unknown): void;
  };
  /** 系统外壳：外部链接交给系统浏览器，不在应用内开无策略的窗口。 */
  readonly shell: {
    openExternal(url: string): Promise<void>;
  };
}
