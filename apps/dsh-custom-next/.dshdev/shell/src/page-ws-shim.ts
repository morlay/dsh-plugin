/**
 * 桌面形态的**页面适配**：把 `ws://app/…` 重写到宿主进程内回环的 ws 端点。
 *
 * 为什么在壳里、不在页面里：页面是 web 与桌面**共用**的（`@morlay/dsh-client-modules` 的 app-boot），
 * 而这个垫片只对桌面形态有意义（浏览器形态有真实的 http 端口，`ws://127.0.0.1:<port>/…` 天然成立）。
 * 壳在渲染进程里最早的一刻（preload 的 `webFrame`）把它注入主 world——`WebSocket` 是页面里的内建对象，
 * 只有主 world 的脚本能换掉它（`contextBridge` 只能加新对象，覆盖不了）。
 *
 * 注入的代码必须**自包含**（不能用 `import`）：它是一段字符串，直接在主 world 里执行。
 */

/**
 * 生成注入代码。
 *
 * @param port - 宿主回环端点端口。
 * @returns 一段自包含脚本（执行即接管 `WebSocket`）。
 */
export function desktopWebSocketShimCode(port: number): string {
  return `(() => {
  const Native = globalThis.WebSocket;
  if (Native === undefined || Native.__dshDesktopShim === true) return;
  const port = ${String(port)};
  const rewrite = (url) => {
    try {
      const parsed = new URL(String(url), globalThis.location.href);
      if (parsed.hostname !== "app") return undefined;
      return "ws://127.0.0.1:" + String(port) + parsed.pathname + parsed.search;
    } catch {
      return undefined;
    }
  };
  class DesktopWebSocket extends Native {
    constructor(url, protocols) {
      const rewritten = rewrite(url);
      super(rewritten === undefined ? url : rewritten, protocols);
    }
  }
  DesktopWebSocket.__dshDesktopShim = true;
  globalThis.WebSocket = DesktopWebSocket;
})();`;
}
