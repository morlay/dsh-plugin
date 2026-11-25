// shell 域的**浏览器半装配**：终端那条链的三行。
//
// 顺序 = 装配序，也就是依赖序：
// - `TerminalEndpointClient` 先：它在自己的 `onInit` 里挂 `terminal` 的 descriptor（`remote.terminal`
//   那一面由此存在），并保证早于每个消费方（`WebTerminalsDefault` 注入它）；
// - `WebTerminalsDefault` 才建得出 `ClientTerminals`（它要那一面，且 `onInit` 里有守卫）；
// - `SidebarTerminalSlots` 最后装上游终端标签，`webTerminals` 从上一行的实例取。
import { provide } from "@morlay/zephyr";
import { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";
import { TerminalEndpointClient } from "./terminal-endpoint.client.ts";

/**
 * 终端界面的行清单（**清单的 home**：别的域的装配面展开这一份，不重抄三行）。
 *
 * 返回类型交给 `const L` 推断成字面量元组：调用方 `...provideShellUi()` 展开后，
 * 每条仍是具体的类，`bootstrapApplication` 的编译期注入检查照旧认得出谁来提供谁。
 * @returns provider 清单。
 */
export function provideShellUi() {
  return provide([TerminalEndpointClient, WebTerminalsDefault, SidebarTerminalSlots])();
}
