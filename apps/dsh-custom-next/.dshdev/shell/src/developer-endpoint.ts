// 后端调试的前端地址：这份 DevTools 前端由桌面 host 自己托管（`@morlay/dsh-desktop-host` 的
// `/node-devtools` 前缀，产物取自上游 `@deepseek-ai/dsh-experimental-inspector` 的 `lib/devtools`）——
// 它按 `ws` 查询参数连端点（值形如 `host:port/path`，前端自己补 `ws://`），连的是 host 回报的
// Node inspector，而不是上游那条跨 realm 的同源路由（决策见
// [ADR 桌面档调试面用 Node inspector](../../.agents/adrs/20261008-桌面档调试面用Node-inspector而非跨realm面板.md)）。

import { DEVTOOLS_ASSETS_PREFIX } from "@morlay/dsh-desktop-host/paths";

/** DevTools 前端在托管前缀下的入口路径（与上游底部面板用的是同一份产物）。 */
const DEVTOOLS_ENTRY = "devtools_app.html";

/**
 * 把 host 回报的调试端点拼成应用 origin 下的 DevTools 入口。
 * @param scheme - 应用自定义协议（壳派生自 app 名）。
 * @param endpoint - host 回报的 WebSocket 端点（`ws://127.0.0.1:<port>/<uuid>`）。
 * @returns 可在窗口里加载的入口 URL。
 * @throws 端点不是 WebSocket 端点，或它的值不能原样进查询串。
 */
export function nodeInspectorDevtoolsUrl(scheme: string, endpoint: string): string {
  const target = new URL(endpoint);
  if (target.protocol !== "ws:" && target.protocol !== "wss:")
    throw new Error(`dsh desktop: the inspector endpoint is not a WebSocket url: ${endpoint}`);
  if (target.search !== "")
    throw new Error(`dsh desktop: the inspector endpoint must not carry a query: ${endpoint}`);
  // 不转义：`:` 与 `/` 在查询值里合法，且这样无论前端做不做解码都拿到同一份地址。
  const socket = `${target.host}${target.pathname}`;
  if (!/^[\u0021-\u007e]+$/u.test(socket) || socket.includes("&") || socket.includes("#"))
    throw new Error(`dsh desktop: the inspector endpoint is not usable in a query: ${endpoint}`);
  return `${scheme}://app${DEVTOOLS_ASSETS_PREFIX}/${DEVTOOLS_ENTRY}?ws=${socket}&panel=console&disableLocaleInfoBar=true`;
}
