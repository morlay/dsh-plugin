// workspace 能力的 client 半：`workspaces` 服务（`ui-workspace` 读它）+ 「工作区组」 的绑定。
export { WorkspaceController } from "./workspace-controller.contract.ts";
export { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
export { WorkspaceRemoteBinding } from "./workspace-remote.binding.ts";
export { WorkspaceSlots } from "./workspace-slots.ts";
export { UiWorkspace } from "./ui-workspace.token.ts";
export { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
export { provideWorkspaceUi } from "./workspace.provide.ts";
export { ContextMenuSlots } from "./context-menu-slots.ts";
// 右栏「文件夹」标签与 file 资源 provider：上游归 workspace（api/workspace-files 的 client 半），
// 所以行放在这里；会话界面从本出口取它们装配。
export { SidebarFilesSlots } from "./sidebar-files-slots.ts";
export { WorkspaceFilesResource } from "./workspace-files-resource.ts";
