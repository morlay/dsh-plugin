// shell 域的**浏览器半**（`@morlay/dsh-shell/ui`）：右栏「终端」标签与它要的 `webTerminals` 服务。
//
// 上游 `ui-sidebar-terminal` 与 `api/terminal-controller` 的 client 半归本域；会话界面的右栏从这里取
// 这两行装配（行注册进会话界面已声明的位置，但 home 在 shell）。
export { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";
export { provideShellUi } from "./shell.provide.ts";
