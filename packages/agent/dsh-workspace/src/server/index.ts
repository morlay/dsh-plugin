// dsh-workspace 的**宿主半**：宿主机面的装配函数 + wire 端点实现。
export { provideWorkspace } from "./workspace.provide.ts";
// 宿主行的实现（同进程端口）：装配函数之外的用法（用例装配一份最小宿主、别的域拼自己的清单）从这里取，
// 与 `session-rdb/server` 出 `SessionAgentControlDefault` 同一个口径。
export { SessionWorkspaceCopyHost } from "./session-workspace-copy.host.ts";
export { SessionWorkspaceHost } from "./session-workspace.host.ts";
export { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
export {
  WorkspaceFilesPlugin,
  WorkspaceFilesRemote,
  type WorkspaceByteRange,
  type WorkspaceByteReadOptions,
  type WorkspaceFileRange,
  type WorkspaceFileScope,
  type WorkspaceFileWatchFrame,
} from "./workspace-files.face.ts";

// `remote.workspaceFiles` 的宿主行（自己 owning 的面，住在自己域里）。
export { provideWorkspaceFiles } from "./workspace-files.provide.ts";
export { WorkspaceFilesDefault } from "./workspace-files.service.ts";
