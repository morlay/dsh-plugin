import { type ProviderList } from "@morlay/zephyr";
import { provideSessionShellSlots } from "./shell/index.ts";
import {
  provideSessionInputSlots,
  provideSessionShell,
  provideSessionSlots,
} from "./session-ui.provide.ts";

/**
 * 对话域的**浏览器半**：一份清单装完本包的界面面。
 *
 * 内部顺序即依赖顺序：
 * 1. `provideSessionShell()`：`SessionLayout` 包装上游 `ui-session`，产出 `uiSession`；
 * 2. `provideSessionShellSlots()`：侧栏骨架，**要 `uiWorkspace`**（由 workspace 域的 `provideWorkspaceUi()` 给，
 *    所以调用方必须把它排在本函数之前）与 `Layout`；
 * 3. `provideSessionSlots()`：主视图 / 内容渲染 / 会话内卡片（产出 `conversation`）；
 * 4. `provideSessionInputSlots()`：输入区触发器、命令 UI 行、`@` 引用——**要 `remote.commands`**，
 *    所以调用方必须把 `provideCommandUi()` 排在本函数之前。
 *
 * @returns provider 清单。
 */
export function provideConversationUi(): ProviderList {
  return [
    ...provideSessionShell(),
    ...provideSessionShellSlots(),
    ...provideSessionSlots(),
    ...provideSessionInputSlots(),
  ];
}
