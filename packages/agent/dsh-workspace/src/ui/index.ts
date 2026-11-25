// workspace 能力的 client 半：两组端点的客户端形态 + 数据面（`workspaces`）+ `file` 资源 provider
// + 两个**独立**的 UI 行（上下文菜单、右栏「文件夹」标签：只依赖框架通用令牌与本域数据面）。
//
// 契约在 `./endpoint`（`WorkspaceController` 的服务面与 `@RemoteGroup` 组契约），不放 UI 层。
// 上游 `ui-workspace` / `ui-directory-picker-native` 那两行要**跨域 UI 上下文**（`uiSession` / `uiWorkspace`），
// 属于「对话界面大组装」的一块：契约与装配都在 `@morlay/dsh-conversation`。
export { WorkspaceEndpointClient } from "./workspace-endpoint.client.ts";
export { WorkspaceFilesEndpointClient } from "./workspace-files-endpoint.client.ts";
export { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
export { provideWorkspaceUi } from "./workspace.provide.ts";
// `file` 资源协议的 provider（上游 `api/workspace-files` 的 client 半，不是 UI 行）。
export { WorkspaceFilesResource } from "./workspace-files-resource.ts";
// 右栏「文件夹」标签（上游 `ui-sidebar-files` 的 client 半）：独立组件，装的是本域的数据面。
export { SidebarFilesSlots } from "./sidebar-files-slots.ts";
