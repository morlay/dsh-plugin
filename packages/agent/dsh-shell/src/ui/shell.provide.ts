// shell 域的**浏览器半装配**：终端标签那两行。
//
// `WebTerminalsDefault` 要在 `SidebarTerminalSlots` 之前（它建的 `webTerminals` 是终端行的依赖）。
import { provide, type ProviderList } from "@morlay/zephyr";
import { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";

/**
 * 终端界面的行清单。
 * @returns provider 清单。
 */
export function provideShellUi(): ProviderList {
  return provide([WebTerminalsDefault, SidebarTerminalSlots])();
}
