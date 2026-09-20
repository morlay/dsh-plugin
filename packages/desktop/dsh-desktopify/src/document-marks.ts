/** 桌面文档标记：客户端按这些属性切换窗口布局（macOS 交通灯内嵌、Windows 自绘 caption）。 */

/** Windows 标题栏高度（DIP），与窗口 `titleBarOverlay.height` 一致。 */
export const WINDOWS_TITLEBAR_HEIGHT = 40;

/** Web UI 写入的主题来源属性。 */
const THEME_SOURCE_ATTRIBUTE = "data-ds-theme-source";

function whenRootReady(root: Document, run: () => void): void {
  // preload 可能早于文档根存在。
  if ((root.documentElement as HTMLElement | null) === null)
    root.defaultView?.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
}

/** 标记页面平台：macOS 布局（侧边栏顶部拖拽条与 logo 下沉）据此启用。 */
export function markDocumentPlatform(platform: NodeJS.Platform, root: Document): void {
  whenRootReady(root, () => {
    root.documentElement.dataset.platform = platform;
  });
}

/** Windows 自绘 caption 标记：布局据此留出标题栏高度、把控制按钮位置让开。 */
export function markWindowsTitlebar(platform: NodeJS.Platform, root: Document): void {
  if (platform !== "win32") return;
  whenRootReady(root, () => {
    root.documentElement.dataset.windowsTitlebar = "";
    root.documentElement.style.setProperty(
      "--dsh-windows-titlebar-height",
      `${String(WINDOWS_TITLEBAR_HEIGHT)}px`,
    );
  });
}

/** macOS：把主题来源转发给主进程，窗口 vibrancy 才会跟随应用配色。 */
export function syncNativeTheme(
  platform: NodeJS.Platform,
  root: Document,
  send: (source: string) => void,
): void {
  if (platform !== "darwin") return;
  let sent: string | undefined;
  const publish = (): void => {
    const value = root.documentElement.getAttribute(THEME_SOURCE_ATTRIBUTE);
    if (value === null || value === sent) return;
    sent = value;
    send(value);
  };
  const observe = (): void => {
    new MutationObserver(publish).observe(root.documentElement, {
      attributeFilter: [THEME_SOURCE_ATTRIBUTE],
    });
    publish();
  };
  if (root.readyState === "loading")
    root.defaultView?.addEventListener("DOMContentLoaded", observe, { once: true });
  else observe();
}
