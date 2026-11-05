import { provide } from "@morlay/zephyr";
import { ContextMenuSlots } from "./context-menu-slots.ts";
import { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
import { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
import { WorkspaceRemoteBinding } from "./workspace-remote.binding.ts";
import { WorkspaceSlots } from "./workspace-slots.ts";

// workspace 的**浏览器半**：数据面 + 位置（上下文菜单、侧栏工作区列表、原生目录选择器）。
//
// 一份清单（调用方一行 `...provideWorkspaceUi()`），内部按依赖排序：
// - `ContextMenuSlots` 必须早于 `WorkspaceSlots`（后者 `inject` 里有 `contextMenus`）；
// - `WorkspaceControllerDefault` / `WorkspaceRemoteBinding` 出 `workspaces` 面，`WorkspaceSlots` 读它。
// 要剔某行用 `without(实现类)`。
export const provideWorkspaceUi = provide([
  ContextMenuSlots,
  WorkspaceControllerDefault,
  WorkspaceRemoteBinding,
  WorkspaceSlots,
  DirectoryPickerNativeSlots,
]);
