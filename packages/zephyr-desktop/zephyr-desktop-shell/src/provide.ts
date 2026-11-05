// 壳的装配清单：**窗口、协议、生命周期都是行**——与业务行共享同一个 Logger 与 Debugger。
import { InjectionToken, type ProviderList } from "@morlay/zephyr";
import type { ZephyrDesktopConfig } from "@morlay/zephyr-cli";

/** Electron 模块的最小面（壳不静态依赖 electron：它是 peer，且只在 Electron 里存在）。 */
export interface ElectronLike {
  readonly app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: never[]) => void): void;
    quit(): void;
    commandLine: { appendSwitch(name: string, value?: string): void };
    setPath(name: string, path: string): void;
    getPath(name: string): string;
    /** 应用名（`package.json` 的 `name`）：没有 `desktop.id` 时用它当数据目录名。 */
    getName(): string;
    disableHardwareAcceleration(): void;
  };
  readonly BrowserWindow: new (options: unknown) => {
    loadURL(url: string): Promise<void>;
    once(event: string, listener: () => void): void;
    show(): void;
    isDestroyed(): boolean;
    isMinimized(): boolean;
    isFocused(): boolean;
    isEnabled(): boolean;
    restore(): void;
    focus(): void;
    close(): void;
    /** 这个 webContents id 是不是本窗口的（目录选择器的准入判据）。 */
    owns(senderId: number): boolean;
    readonly webContents: {
      readonly id: number;
      on(event: string, listener: (...args: never[]) => void): void;
      openDevTools(options?: { mode?: string }): void;
      send(channel: string, ...args: unknown[]): void;
      setIgnoreMenuShortcuts(ignore: boolean): void;
    };
  };
  readonly dialog: {
    showOpenDialog(
      window: unknown,
      options: unknown,
    ): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
  };
  readonly ipcMain: {
    /** 渲染进程的 invoke：`event.senderId` 是发起方的 webContents id（目录选择器的准入判据）。 */
    handle(
      channel: string,
      listener: (event: { readonly senderId?: number }, ...args: unknown[]) => Promise<unknown>,
    ): void;
  };
  readonly protocol: {
    registerSchemesAsPrivileged(schemes: readonly unknown[]): void;
    handle(scheme: string, handler: (request: { url: string }) => Promise<unknown>): void;
  };
}

/** 壳的部署参数。 */
export interface DesktopShellOptions {
  /** Electron 模块（由主进程入口传进来）。 */
  readonly electron: ElectronLike;
  /** 产物根：静态面所在目录（打包形态是 `Resources/dist`）。 */
  readonly resourcesDir: string;
  /** 配置里的 `desktop` 段。 */
  readonly desktop?: ZephyrDesktopConfig;
}

/** 壳参数令牌。 */
export const DesktopShell = InjectionToken<DesktopShellOptions>("desktop-shell");

/**
 * 壳的清单。
 * @param options - Electron 面、产物根与桌面身份。
 * @returns 提供清单。
 */
export function provideDesktopShell(options: DesktopShellOptions): ProviderList {
  return [{ provide: DesktopShell, useValue: options }];
}
