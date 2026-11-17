// 面板的 **preload 桥**：把页面侧的五个意图转成 IPC，**不带任何决策**。
//
// 为什么这里一条判据都不放：协议白名单、单实例、权限与生命周期都在主进程（`browser-pane.ts` 的路由 +
// `browser-pane-view.ts` 的适配器）。桥只要「照发、照收」，将来渲染侧的实现换了也不用动判据。
import type { PaneOpenInput, PaneRect, PaneState } from "./browser-pane.ts";
import { DESKTOP_IPC } from "./ipc.ts";

/** 一次 `state` 推送（主进程 → 渲染进程）。 */
export interface BrowserPaneChange {
  readonly id: string;
  readonly state: PaneState | undefined;
}

/** 桥需要的 ipcRenderer 面（窄到只够转发：假件也好写）。 */
export interface BrowserPaneIpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

/** 暴露成 `window.__DSH_BROWSER_PANE__` 的那张面。 */
export interface BrowserPaneBridge {
  open(input: PaneOpenInput): Promise<unknown>;
  bounds(id: string, bounds: PaneRect): Promise<unknown>;
  navigate(id: string, url: string): Promise<unknown>;
  close(id: string): Promise<unknown>;
  state(id: string): Promise<unknown>;
  /**
   * 订阅主进程推来的状态（**唯一一条**：渲染侧不再自己推导 url/title/loading）。
   * @param listener - 收到 `{ id, state }`。
   * @returns 退订（面板关闭 / 窗口关闭都要调）。
   */
  subscribe(listener: (change: BrowserPaneChange) => void): () => void;
}

/**
 * 造桥。
 * @param ipc - `ipcRenderer`（`invoke` / `on` / `off`）。
 * @returns 只转发的桥。
 */
export function browserPaneBridgeOf(ipc: BrowserPaneIpcLike): BrowserPaneBridge {
  return {
    open: async (input) => ipc.invoke(DESKTOP_IPC.browserOpen, input),
    bounds: async (id, bounds) => ipc.invoke(DESKTOP_IPC.browserBounds, id, bounds),
    navigate: async (id, url) => ipc.invoke(DESKTOP_IPC.browserNavigate, id, url),
    close: async (id) => ipc.invoke(DESKTOP_IPC.browserClose, id),
    state: async (id) => ipc.invoke(DESKTOP_IPC.browserState, id),
    subscribe: (listener) => {
      // ipcRenderer 的监听第一个参数是 IPC event：这里剥掉，页面侧只看到业务负载。
      const handler = (...args: unknown[]): void => listener(args[1] as BrowserPaneChange);
      ipc.on(DESKTOP_IPC.browserChanged, handler);
      return () => {
        ipc.off(DESKTOP_IPC.browserChanged, handler);
      };
    },
  };
}
