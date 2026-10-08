// 壳的「后端调试」面：把 host 运行时开的 Node inspector 端点接到一个独立的 DevTools 窗口上。
// 为什么是 Node inspector 而不是上游那套跨 realm 面板，见
// [ADR 桌面档调试面用 Node inspector](../../.agents/adrs/20261008-桌面档调试面用Node-inspector而非跨realm面板.md)。

import { BrowserWindow, Menu, MenuItem, dialog } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { nodeInspectorDevtoolsUrl } from "./developer-endpoint.ts";

// 后端调试面要的 host 面（`DesktopHostProcess` 的结构子集）：命令 + 端点状态订阅。
export interface DeveloperHostProcess {
  inspect(port?: number): void;
  endInspect(): void;
  onInspected(listener: (state: { url: string | null; message?: string }) => void): () => void;
}

export interface DeveloperMenuOptions {
  // 应用自定义协议（壳派生自 app 名）。
  readonly scheme: string;
  readonly appName: string;
  // 后端进程还没起来时返回 undefined——菜单仍然可用，点了给提示。
  readonly host: () => DeveloperHostProcess | undefined;
  // 对话框的父窗口。
  readonly mainWindow: () => BrowserWindow | undefined;
}

function reportFailure(options: DeveloperMenuOptions, title: string, detail: string): void {
  console.error(`[dsh-shell] ${title}: ${detail}`);
  const parent = options.mainWindow();
  if (parent === undefined || parent.isDestroyed()) dialog.showErrorBox(title, detail);
  else void dialog.showMessageBox(parent, { type: "error", message: title, detail });
}

// 往应用菜单的 View 子菜单里插两项（分隔符 + 调试项）；现有菜单没有 View 时返回 false。
function insertIntoViewMenu(menu: Menu | null, toggle: MenuItemConstructorOptions): boolean {
  const view = menu?.items.find((entry) => entry.role === "viewMenu")?.submenu;
  if (view === undefined) return false;
  const devtools = view.items.findIndex((entry) => entry.role === "toggleDevTools");
  const at = devtools === -1 ? view.items.length : devtools + 1;
  view.insert(at, new MenuItem({ type: "separator" }));
  view.insert(at + 1, new MenuItem(toggle));
  return true;
}

// 现有菜单不可用时的兜底：只摆桌面应用该有的几项。macOS 的 app 菜单与 window 菜单不能省，
// 少了它们 Cmd+Q / Cmd+W 这类系统快捷键会失效。
function buildFallbackMenu(toggle: MenuItemConstructorOptions): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" } as const] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        toggle,
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * 把「后端调试（Node Inspector）」挂进应用菜单的 View 里，并管理它那个 DevTools 窗口。
 * 勾选 ⇔ 端点开着 ⇔ 窗口在：关窗口、取消勾选、host 回报端点没了，三条都收敛到同一状态。
 * @param options - 协议、app 名与 host 取值函数。
 * @returns 退订与收尾。
 */
export function installDeveloperMenu(options: DeveloperMenuOptions): { dispose(): void } {
  let window: BrowserWindow | undefined;
  // 我们自己关窗口时置位：那一刻别再当成「用户关掉调试」。
  let closingWindow = false;
  let releaseInspected: (() => void) | undefined;
  // 菜单项实例只有挂上之后才有，勾选状态一律经它同步（模板对象里拿不到实例）。
  let toggleItem: MenuItem | undefined;
  const setChecked = (checked: boolean): void => {
    if (toggleItem !== undefined) toggleItem.checked = checked;
  };

  function closeWindow(): void {
    const current = window;
    window = undefined;
    if (current === undefined || current.isDestroyed()) return;
    // 标志由 `closed` 处理器消费：`close()` 之后 `closed` 是另派发的，不能在这里复位。
    closingWindow = true;
    current.close();
  }

  // 收掉这次调试：订阅、窗口、host 端点一起消失（重复调用是幂等的）。
  function closeInspectorHost(): void {
    releaseInspected?.();
    releaseInspected = undefined;
    closeWindow();
    try {
      options.host()?.endInspect();
    } catch (error) {
      console.error("[dsh-shell] host inspector shutdown failed", error);
    }
  }

  function openWindow(endpoint: string): void {
    const current = window;
    if (current !== undefined && !current.isDestroyed()) {
      current.focus();
      return;
    }
    let target: string;
    try {
      target = nodeInspectorDevtoolsUrl(options.scheme, endpoint);
    } catch (error) {
      setChecked(false);
      releaseInspected?.();
      releaseInspected = undefined;
      reportFailure(options, "后端调试", error instanceof Error ? error.message : String(error));
      return;
    }
    const created = new BrowserWindow({
      width: 1_280,
      height: 820,
      title: `${options.appName} · Node Inspector`,
      backgroundColor: "#202124",
    });
    window = created;
    created.on("closed", () => {
      if (window === created) window = undefined;
      // 标志是一次性的：无论谁关的，用过就复位。
      const closingOurselves = closingWindow;
      closingWindow = false;
      if (closingOurselves) return;
      // 用户关掉窗口就等于关掉这次调试：勾选、端点、窗口收敛到「没开」。
      closeInspectorHost();
      setChecked(false);
    });
    void created.loadURL(target);
  }

  const toggle: MenuItemConstructorOptions = {
    id: "desktop-host-inspector",
    label: "后端调试（Node Inspector）",
    type: "checkbox",
    checked: false,
    click: (menu) => {
      toggleItem = menu;
      if (!menu.checked) {
        closeInspectorHost();
        return;
      }
      const host = options.host();
      if (host === undefined) {
        setChecked(false);
        reportFailure(options, "后端调试", "后端进程还没就绪，稍后再试。");
        return;
      }
      releaseInspected?.();
      releaseInspected = host.onInspected((state) => {
        if (state.url !== null) {
          openWindow(state.url);
          return;
        }
        setChecked(false);
        closeWindow();
        if (state.message !== undefined)
          reportFailure(options, "后端调试端点没有开起来", state.message);
      });
      try {
        // 端口交给 host 挑（0 = 随机），壳不猜；已有端点（dev 的 `--inspect`）由 host 复用。
        host.inspect(0);
      } catch (error) {
        releaseInspected?.();
        releaseInspected = undefined;
        setChecked(false);
        reportFailure(options, "后端调试", error instanceof Error ? error.message : String(error));
      }
    },
  };

  // 默认菜单不一定就绪（真机上 `Menu.getApplicationMenu()` 可能是 null）：能插就插，
  // 插不进去就自建一套——调试面不该因为菜单形态缺失而整个不可用。
  if (!insertIntoViewMenu(Menu.getApplicationMenu(), toggle))
    Menu.setApplicationMenu(buildFallbackMenu(toggle));

  return { dispose: closeInspectorHost };
}
