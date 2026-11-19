// 面板与**壳**之间的那张面：`__DSH_BROWSER_PANE__`（preload 暴露，只转发 IPC）。
//
// 这里**没有任何判据**：协议白名单、单实例、权限、生命周期都在壳的主进程那一侧。本包只做两件事——
// 把意图发过去（开 / 摆位置 / 导航 / 关），把状态收回来（`subscribe` 是唯一来源，本包不自己推导 url）。

/** 面板在窗口坐标系里占的矩形（与壳的 `PaneRect` 同一个形状：两个包不互相依赖，各写一份）。 */
export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 面板此刻的样子（**只有主进程知道**：本包只显示它推来的值）。 */
export interface PaneState {
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly loading: boolean;
}

/** 一次状态推送。 */
export interface PaneChange {
  readonly id: string;
  readonly state: PaneState | undefined;
}

/** preload 桥的形状（`window.__DSH_BROWSER_PANE__`）。 */
export interface BrowserPaneBridgeLike {
  open(input: {
    readonly id: string;
    readonly url?: string;
    readonly bounds: PaneRect;
  }): Promise<unknown>;
  bounds(id: string, bounds: PaneRect): Promise<unknown>;
  navigate(id: string, url: string): Promise<unknown>;
  close(id: string): Promise<unknown>;
  state(id: string): Promise<unknown>;
  subscribe(listener: (change: PaneChange) => void): () => void;
}

/**
 * 拿桥（非桌面宿主里没有它：面板在这种宿主里不渲染）。
 * @param host - 默认当前 window（测试可注入）。
 * @returns 桥，或 `undefined`。
 */
export function browserPaneOf(
  host: { readonly __DSH_BROWSER_PANE__?: BrowserPaneBridgeLike } = globalThis as never,
): BrowserPaneBridgeLike | undefined {
  return host.__DSH_BROWSER_PANE__;
}

/**
 * 把 DOM 矩形换算成面板矩形（整数像素；壳照这个摆 view）。
 * @param element - 面板的占位元素（`null` 表示还没挂上）。
 * @returns 面板矩形，或 `undefined`（元素不在就什么都不报）。
 */
export function panelBoundsOf(
  element: { getBoundingClientRect(): DOMRect } | null,
): PaneRect | undefined {
  if (element === null) return undefined;
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}
