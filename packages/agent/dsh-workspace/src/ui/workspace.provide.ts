import { provide } from "@morlay/zephyr";
import { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
import { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
import { WorkspaceRemoteBinding } from "./workspace-remote.binding.ts";
import { WorkspaceSlots } from "./workspace-slots.ts";

/** workspace 的**数据面**：`workspaces` 服务 + `remote.workspace` 的 descriptor 绑定。 */
export const provideWorkspaceUi = provide([WorkspaceControllerDefault, WorkspaceRemoteBinding]);

/** workspace 的**位置**：侧栏的工作区列表与原生目录选择器（壳的一部分）。 */
export const provideWorkspaceSlots = provide([WorkspaceSlots, DirectoryPickerNativeSlots]);
