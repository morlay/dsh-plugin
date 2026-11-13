// 窗口选项的推导：**纯函数**，三处默认值（尺寸、外观、webPreferences）。
import type { ZephyrDesktopConfig } from "@morlay/zephyr-cli";
import type { WindowState } from "./window-state.ts";

/** 窗口外观（与平台相关的那几项）。 */
export interface WindowFrame {
  /** macOS：无标题栏但保留红绿灯按钮。 */
  readonly titleBarStyle?: "hidden" | "hiddenInset" | "default";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
  readonly vibrancy?: "sidebar" | "under-window";
  readonly visualEffectState?: "active" | "followWindow";
  /** Windows / Linux：去掉系统边框，用 overlay 留出系统按钮的位置。 */
  readonly frame?: boolean;
  readonly titleBarOverlay?: {
    readonly color: string;
    readonly symbolColor: string;
    readonly height: number;
  };
  readonly backgroundColor: string;
}

/** 窗口选项（Electron `BrowserWindow` 用的那个子集）。 */
export interface WindowOptions extends WindowFrame {
  /** 位置只在「上次关窗的位置」存在时给（否则让 Electron 自己居中）。 */
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly show: boolean;
  readonly webPreferences: {
    readonly contextIsolation: boolean;
    readonly nodeIntegration: boolean;
    readonly sandbox: boolean;
    /** 只有桌面形态才有的桥（目录选择器、平台标记）。 */
    readonly preload?: string;
  };
}

/** 缺省尺寸：够放下侧栏与一栏对话（也是第一次启动的尺寸）。 */
export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 } as const;

/** 缺省最小尺寸。 */
const DEFAULT_MIN_SIZE = { minWidth: 800, minHeight: 600 } as const;

/** 开窗时传进来的那两样（都不是配置：一个来自构建产物，一个来自上次关窗）。 */
export interface WindowSizing {
  /** preload 脚本绝对路径（桌面桥）。 */
  readonly preload?: string;
  /** 上次关窗时的状态（位置、尺寸、最大化）。 */
  readonly state?: WindowState;
}

/**
 * 按平台给窗口外观：**无标题栏**，窗口内容顶到顶边。
 *
 * macOS 保留红绿灯（`hiddenInset` + 指定内缩），左侧栏因此要给顶部留白（页面侧按
 * `document.documentElement.dataset.titlebar` 折叠）；Windows 用 `titleBarOverlay`。
 * @param platform - 平台（注入以便测三个平台）。
 * @returns 外观选项。
 */
export function windowFrameOf(platform: NodeJS.Platform): WindowFrame {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: "sidebar",
      // 'active' 让失焦时的材质稳定；'followWindow' 会把侧边栏洗白。
      visualEffectState: "active",
      backgroundColor: "#00000000",
    };
  }
  if (platform === "win32") {
    return {
      frame: false,
      titleBarOverlay: { color: "#00000000", symbolColor: "#e5e5e5", height: 40 },
      backgroundColor: "#111111",
    };
  }
  return { frame: false, backgroundColor: "#111111" };
}

/**
 * 从配置与上次关窗的状态推导窗口选项。
 *
 * `nodeIntegration: false` + `contextIsolation: true` 不是保守，是**必须**：页面来自 dev server
 * （打包形态也走它），内容里跑的是客户端的整棵 React 树，给渲染进程 node 权限等于把宿主的文件系统交出去。
 * @param desktop - 配置里的 `desktop` 段（可能没有 `window`）。
 * @param platform - 平台（注入以便测三个平台）。
 * @param sizing - preload 路径与上次关窗的状态。
 * @returns 窗口选项。
 */
export function windowOptionsOf(
  desktop: ZephyrDesktopConfig | undefined,
  platform: NodeJS.Platform = process.platform,
  sizing: WindowSizing = {},
): WindowOptions {
  const window = desktop?.window;
  // 位置与尺寸只有一个来源：上次关窗的状态（`window-state.ts` 已经夹进工作区，也补过配置尺寸）。
  const bounds = sizing.state?.bounds;
  return {
    ...windowFrameOf(platform),
    ...(bounds === undefined ? {} : { x: bounds.x, y: bounds.y }),
    width: bounds?.width ?? window?.width ?? DEFAULT_WINDOW_SIZE.width,
    height: bounds?.height ?? window?.height ?? DEFAULT_WINDOW_SIZE.height,
    minWidth: window?.minWidth ?? DEFAULT_MIN_SIZE.minWidth,
    minHeight: window?.minHeight ?? DEFAULT_MIN_SIZE.minHeight,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // **sandbox 必须关**：Electron 的 sandboxed preload 只认 CJS，而我们的 preload 是 ESM
      // （与 main.mjs 同一条构建链）。开了 sandbox，preload 会加载失败（报「Unable to load preload」）。
      // 隔离仍由 contextIsolation + nodeIntegration:false 保证，页面只加载本地 dev server。
      sandbox: false,
      ...(sizing.preload === undefined ? {} : { preload: sizing.preload }),
    },
  };
}
