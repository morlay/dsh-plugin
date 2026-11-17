// 包根：面板的浏览器半（装配函数 + 桥的形状）。宿主没有这一半——面板的容器在主进程（壳）那一侧。
export {
  browserPaneOf,
  panelBoundsOf,
  PANEL_ID,
  type BrowserPaneBridgeLike,
  type PaneRect,
  type PaneState,
} from "./ui/index.ts";
export { provideDesktopPanelUi } from "./ui/index.ts";
