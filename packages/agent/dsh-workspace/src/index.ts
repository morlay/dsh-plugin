// workspace 域的包根：契约 + host 半的行（`remote.workspace` 的宿主实现与 wire 路由）。
export * from "./contract/index.ts";
export * from "./directory-picker.service.ts";
// 上游 `Workspace` 的实现类：属 workspace 的面，下游从这里取（不直连上游）。
export { default as WorkspacePlugin } from "@deepseek-ai/dsh-workspace";

export * from "./workspace.service.ts";
export { DirectoryPickerControllerRow } from "./server/directory-picker.host.ts";
export { SessionWorkspaceHost } from "./server/session-workspace.host.ts";
export { WorkspaceControllerRow } from "./server/workspace-controller.host.ts";
