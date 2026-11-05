// dsh-workspace 的**宿主半**：宿主机面的装配函数 + wire 端点实现。
export { provideWorkspace } from "./workspace.provide.ts";
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
