// 壳的公开面：一份清单、窗口选项推导、自定义协议的归一。
export {
  DesktopShell,
  provideDesktopShell,
  type DesktopShellOptions,
  type ElectronLike,
} from "./provide.ts";
export { windowOptionsOf, type WindowOptions } from "./window.ts";
export { isInside, mimeOf, resourcePathOf, SCHEME } from "./protocol.ts";
export { shellDebugOf, type ShellDebug } from "./debug.ts";
