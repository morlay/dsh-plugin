// 面板的浏览器半出口。
export {
  browserPaneOf,
  panelBoundsOf,
  type BrowserPaneBridgeLike,
  type PaneChange,
  type PaneRect,
  type PaneState,
} from "./panel-bridge.ts";
export { PANEL_ID, SidebarRightPaneTabSlot } from "./panel-slots.ts";
export { DesktopPanelTab } from "./panel-tab.ts";
export { DesktopPanelView } from "./panel.view.tsx";
export { provideDesktopPanelUi } from "./panel.provide.ts";
