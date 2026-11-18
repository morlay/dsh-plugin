// shell 域的**浏览器半装配**：终端那条链的三行。
//
// 顺序 = 装配序，也就是依赖序：
// - `RemoteMountsDefault` 先把 `terminal` 的 descriptor 挂上（`remote.terminal` 那一面由此存在）；
// - `WebTerminalsDefault` 才建得出 `ClientTerminals`（它要那一面，且 `onInit` 里有守卫）；
// - `SidebarTerminalSlots` 最后装上游终端标签，`webTerminals` 从上一行的实例取。
import { provide, type ProviderList } from "@morlay/zephyr";
import { RemoteMountsDefault } from "./remote-mounts.service.ts";
import { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";

/**
 * 终端界面的行清单。
 * @returns provider 清单。
 */
export function provideShellUi(): ProviderList {
  return provide([RemoteMountsDefault, WebTerminalsDefault, SidebarTerminalSlots])();
}
