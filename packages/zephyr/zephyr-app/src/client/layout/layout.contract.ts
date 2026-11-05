// 布局契约（上游 `dsh-client-ui-layout` 的 `layout` 服务）：面板选择与列状态。
//
// **面要够上游用**：各 client 行拿到的 `ctx.layout` 是这一行的实例（`fromCordis` 只绑契约上声明的
// 成员），少一个方法，调用点就是 `undefined is not a function`——而它常发生在 `useLayoutEffect` /
// 事件回调里，错误会被 React 或 `void …catch()` 吞掉，症状是"点了没反应"。
// 右侧栏就是这样：`ui-sidebar-right` 的 `syncPresentation` 调 `layout.openRightbar`，契约里没有它，
// 于是 `expanded` 变成 true、面板 seat 也渲染了，列宽却一直是 0。
import type { ILayout } from "@deepseek-ai/dsh-client-ui-layout/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Layout {
  abstract readonly panelInfo: ILayout["panelInfo"];

  abstract readonly toggleSidebar: ILayout["toggleSidebar"];

  /** 展开右栏（`track` 决定是否占列宽，`fullscreen` 决定是否覆盖主区）。 */
  abstract readonly openRightbar: ILayout["openRightbar"];

  /** 收起右栏。 */
  abstract readonly closeRightbar: ILayout["closeRightbar"];

  /** 主区面板切换（`ui-conversation` / `ui-session` 用它切主视图）。 */
  abstract readonly selectPanel: ILayout["selectPanel"];

  /** 开一代新的导航（返回的 signal 被 abort 时，之前的导航作废）。 */
  abstract readonly beginNavigation: ILayout["beginNavigation"];
}
