// shell 域的**浏览器半装配**：终端那条链的四行。
//
// 顺序 = 装配序，也就是依赖序：
// - `TerminalEndpointClient` 先（`WebTerminalsDefault` 注入它——没这一行装配期就报「没有提供者」）；
// - `RemoteMountsDefault` 把 `terminal` 的 descriptor `$mount` 上（`remote.terminal` 那一面由此存在）；
// - `WebTerminalsDefault` 才建得出 `ClientTerminals`（它要那一面，且 `onInit` 里有守卫）；
// - `SidebarTerminalSlots` 最后装上游终端标签，`webTerminals` 从上一行的实例取。
import { provide } from "@morlay/zephyr";
import { RemoteMountsDefault } from "./remote-mounts.service.ts";
import { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";
import { TerminalEndpointClient } from "./terminal-endpoint-client.ts";

/**
 * 终端界面的行清单（**清单的 home**：别的域的装配面展开这一份，不重抄四行）。
 *
 * 返回类型交给 `const L` 推断成字面量元组：调用方 `...provideShellUi()` 展开后，
 * 每条仍是具体的类，`bootstrapApplication` 的编译期注入检查照旧认得出谁来提供谁。
 * @returns provider 清单。
 */
export function provideShellUi() {
  return provide([
    TerminalEndpointClient,
    RemoteMountsDefault,
    WebTerminalsDefault,
    SidebarTerminalSlots,
  ])();
}
