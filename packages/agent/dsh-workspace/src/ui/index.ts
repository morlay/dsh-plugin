// workspace 能力的 client 半：`workspaces` 服务（`ui-workspace` 读它）+ `remote.workspace` 的绑定。
export { WorkspaceController } from "./workspace-controller.contract.ts";
export { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
export { WorkspaceRemoteBinding } from "./workspace-remote.binding.ts";
export { WorkspaceSlots } from "./workspace-slots.ts";
export { UiWorkspace } from "./ui-workspace.token.ts";
export { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
export { provideWorkspaceSlots, provideWorkspaceUi } from "./workspace.provide.ts";
