// 导航判据：**纯函数**决定一次跳转是「本源的」「交给系统浏览器的」还是「拒掉的」。
//
// 为什么要在壳里裁：页面里跑的是整棵 React 树（含 markdown 渲染），一条 http(s) 链接就会
// 开一个没有 preload、没有策略的新窗口；非 http 的跳转（`file:` / `javascript:`）更会把窗口导航走，
// 而桌面窗口没有浏览器 chrome，退不回来。
/** 一次导航该怎么做。 */
export type NavigationPlan =
  | { readonly kind: "allow" }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "deny" };

/** 交给系统浏览器的 scheme（页面自己的源走 allow，不走这里）。 */
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * 判一次跳转。
 * @param target - 目标 URL（可以是相对路径）。
 * @param origin - 页面自己的源（`http://127.0.0.1:<port>`）。
 * @returns 处理方式。
 */
export function navigationPlanOf(target: string, origin: string): NavigationPlan {
  const base = urlOf(origin);
  const url = urlOf(target, origin);
  if (base === undefined || url === undefined) return { kind: "deny" };
  // 本源：vite 自己的 HMR、换页与静态资源都在这里（打包形态也走 http，没有第二条链）。
  if (url.origin === base.origin) return { kind: "allow" };
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: "external", url: url.href };
  return { kind: "deny" };
}

/**
 * @param target - 目标 URL。
 * @param base - 相对路径的基准（缺省不解析相对路径）。
 * @returns URL，或 `undefined`（解析不出来）。
 */
function urlOf(target: string, base?: string): URL | undefined {
  try {
    return base === undefined ? new URL(target) : new URL(target, base);
  } catch {
    return undefined;
  }
}
