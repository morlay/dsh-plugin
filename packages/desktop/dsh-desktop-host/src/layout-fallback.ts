/**
 * 桌面侧边栏的兜底：macOS 形态下侧边栏收起时列宽为 0（完全隐藏），唯一的重开入口在会话头部
 * 的 leading 槽（`data-conversation-header-leading`）。没开会话时那个槽不存在，收起后就没有任何
 * 入口——这里在「缺入口」的情况下把收起的列宽留成 56px 的 rail，rail 自带展开按钮。
 *
 * 只动 `style` 属性文本（React 每次渲染会重写它，观察器随之重新判定），不依赖 CSSOM 对 grid 的支持。
 * 函数自包含（不引用模块外的符号）：注入时用它的源码文本包成 IIFE 交给页面。
 */

/** 与客户端 `SIDEBAR_COLLAPSED` 一致的 rail 宽度。 */
export const SIDEBAR_RAIL_WIDTH = 56;

/**
 * 给收起的侧边栏补一个 rail——只在本该完全隐藏、又没有别处入口时。
 * @param doc - 页面文档（注入形态下就是 `document`）。
 */
export function applySidebarRailFallback(doc: Document): void {
  // 选择器是上游写入的稳定标注：AppFrame 的 data-sidebar-collapsed、ConversationSession 的
  // data-conversation-header-leading。函数体内联全部常量与正则，注入形态不依赖模块作用域。
  const sync = (): void => {
    if (doc.documentElement.dataset.platform !== "darwin") return;
    const frame = doc.querySelector("[data-sidebar-collapsed]");
    if (frame === null) return;
    if (doc.querySelector("[data-conversation-header-leading] button") !== null) return;
    const style = frame.getAttribute("style");
    if (style === null) return;
    const hidden = /grid-template-columns:\s*0px/u;
    if (!hidden.test(style)) return;
    frame.setAttribute("style", style.replace(hidden, "grid-template-columns: 56px"));
  };
  new MutationObserver(sync).observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "data-sidebar-collapsed", "data-platform"],
  });
  sync();
}

/** 注入 index 的兜底行：函数源码即脚本，页面加载后立即可用。 */
export const DESKTOP_LAYOUT_FALLBACK_SCRIPT = `(${applySidebarRailFallback.toString()})(document)`;
