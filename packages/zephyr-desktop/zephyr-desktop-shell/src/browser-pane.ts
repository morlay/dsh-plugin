// **内嵌浏览器面板**的接缝：一个矩形里的网页容器由**主进程**创建与导航，渲染进程只发意图、只报矩形。
//
// 为什么不给渲染进程 `<webview>`：那等于让页面自己造原生容器（第二条权限面，而且 `webviewTag` 一开
// 就绕不过去）。这里渲染进程拿到的只有下面这五个动作。
//
// 适配器是 Electron 的 `WebContentsView` + 独立 session 分区；测试用假适配器（`browser-pane.spec`）。
import { browserUrlAllowed } from "./browser-url.ts";

/** 面板在窗口坐标系里占的矩形（页面侧算，主进程只照着摆）。 */
export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 面板此刻的样子（回推给渲染进程画地址栏与标题）。 */
export interface PaneState {
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly loading: boolean;
}

/** 一次打开要的东西。 */
export interface PaneOpenInput {
  /** 面板 id（侧栏目前只有一个浏览器 tab；将来多 tab 就是 tab id）。 */
  readonly id: string;
  /** 起始地址（缺省开空白页）。 */
  readonly url?: string;
  readonly bounds: PaneRect;
}

/** 主进程侧的浏览器接缝。 */
export interface BrowserPanePort {
  /** 已经开着的 pane id。 */
  readonly opened: readonly string[];

  /**
   * 建一个 pane（同一个 id 已经有就什么都不做：不叠实例）。
   * @param input - id、起始地址与矩形。
   * @returns 建完。
   */
  open(input: PaneOpenInput): Promise<void>;

  /**
   * 摆到哪里（窗口坐标系；页面侧布局变化时调）。
   * @param id - pane id。
   * @param bounds - 新矩形。
   */
  setBounds(id: string, bounds: PaneRect): void;

  /**
   * 导航（判据已经在 {@link BrowserPaneRoutes.navigate} 里过了；这里只管照做）。
   * @param id - pane id。
   * @param url - 目标地址。
   * @returns 发起完成。
   */
  navigate(id: string, url: string): Promise<void>;

  /**
   * 关掉并销毁（没开着也要能调：退出路径无条件走这里）。
   * @param id - pane id。
   * @returns 关完。
   */
  close(id: string): Promise<void>;

  /**
   * @param id - pane id。
   * @returns 当前状态（没开着就是 `undefined`）。
   */
  state(id: string): PaneState | undefined;
}

/** 渲染进程能发的那几个意图（IPC 的路由面）。 */
export interface BrowserPaneRoutes {
  /**
   * 打开面板（地址非法就不建）。
   * @param input - id、起始地址与矩形。
   * @returns 结果（非法地址给原因）。
   */
  open(input: PaneOpenInput): Promise<{ ok: true } | { ok: false; reason: string }>;

  /**
   * @param id - pane id。
   * @param bounds - 新矩形。
   * @returns 这个 pane 在不在（不在就什么都不做）。
   */
  setBounds(id: string, bounds: PaneRect): boolean;

  /**
   * 导航到一个用户给的地址。
   * @param id - pane id。
   * @param url - 目标地址。
   * @returns 结果（非法地址或 pane 不在时给原因）。
   */
  navigate(id: string, url: string): Promise<{ ok: true } | { ok: false; reason: string }>;

  /**
   * @param id - pane id。
   * @returns 关完（没开着也当作成功）。
   */
  close(id: string): Promise<void>;

  /**
   * @param id - pane id。
   * @returns 当前状态（没开着就是 `undefined`）。
   */
  state(id: string): PaneState | undefined;
}

/** 造路由要的东西。 */
export interface BrowserPaneRoutesInput {
  /** 主进程侧接缝（真适配器或假件）。 */
  readonly port: BrowserPanePort;
  /** session 分区名（面板与主页面不同分区：cookie 与 storage 互不可见）。 */
  readonly partition: string;
}

/**
 * 把接缝收成渲染进程能发的那五个意图：**判据都在这里**（协议白名单、pane 在不在、重复 open）。
 * @param input - 接缝与分区名。
 * @returns 路由。
 */
export function browserPaneRoutesOf(input: BrowserPaneRoutesInput): BrowserPaneRoutes {
  const opened = (id: string): boolean => input.port.opened.includes(id);
  return {
    async open(request: PaneOpenInput): Promise<{ ok: true } | { ok: false; reason: string }> {
      const url = request.url;
      if (url !== undefined && url !== "" && !browserUrlAllowed(url)) {
        return { ok: false, reason: `面板只打开 http / https 地址：${url}` };
      }
      if (opened(request.id)) return { ok: true };
      await input.port.open(request);
      return { ok: true };
    },
    setBounds(id: string, bounds: PaneRect): boolean {
      if (!opened(id)) return false;
      input.port.setBounds(id, bounds);
      return true;
    },
    async navigate(id: string, url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (!browserUrlAllowed(url))
        return { ok: false, reason: `面板只打开 http / https 地址：${url}` };
      if (!opened(id)) return { ok: false, reason: `面板 ${id} 没有打开` };
      await input.port.navigate(id, url);
      return { ok: true };
    },
    async close(id: string): Promise<void> {
      if (!opened(id)) return;
      await input.port.close(id);
    },
    state(id: string): PaneState | undefined {
      return input.port.state(id);
    },
  };
}
