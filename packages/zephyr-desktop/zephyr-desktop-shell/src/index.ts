// 壳的公开面：窗口选项与状态、菜单模板、导航判据、单实例聚焦、调试面。
export {
  DEFAULT_WINDOW_SIZE,
  windowFrameOf,
  windowOptionsOf,
  type WindowFrame,
  type WindowOptions,
  type WindowSizing,
} from "./window.ts";
export {
  loadWindowState,
  saveWindowState,
  WINDOW_STATE_FILE,
  windowStateOf,
  type WindowBounds,
  type WindowState,
  type WorkArea,
} from "./window-state.ts";
export { menuTemplateOf, type MenuItemSpec, type MenuTemplateInput } from "./menu.ts";
export { navigationPlanOf, type NavigationPlan } from "./navigation.ts";
export { focusWindowOf, type FocusOutcome, type FocusTarget } from "./single-instance.ts";
export { shellDebugOf, type ShellDebug } from "./debug.ts";
export type { ElectronLike, ElectronWebContents, ElectronWindow } from "./electron-like.ts";
