import { provide } from "@morlay/zephyr";
import { ContextMenuSlots } from "./context-menu-slots.ts";
import { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
import { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
import { WorkspaceRemoteBinding } from "./workspace-remote.binding.ts";
import { WorkspaceSlots } from "./workspace-slots.ts";

/** workspace 的**数据面**：`workspaces` 服务 + `remote.workspace` 的 descriptor 绑定。 */
export const provideWorkspaceUi = provide([WorkspaceControllerDefault, WorkspaceRemoteBinding]);

/** workspace 的**位置**：上下文菜单 + 侧栏的工作区列表 + 原生目录选择器（壳的一部分）。 */
// 顺序即依赖：`ui-workspace` 的 `inject` 里有 `contextMenus`，菜单行必须排在它前面。
export const provideWorkspaceSlots = provide([ContextMenuSlots, WorkspaceSlots, DirectoryPickerNativeSlots]);
