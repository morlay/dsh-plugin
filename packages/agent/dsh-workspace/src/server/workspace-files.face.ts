// workspace-files 的**宿主面词汇**（上游 `@deepseek-ai/dsh-api-workspace-files`）：本域 owning。
//
// 别的域要用这份上游插件（sandbox 的 `workspaceFiles` 行把它的五个方法接到 wire 上）时从这里取，
// 不直连上游包——同一个上游包被两个域直接 import 就是那条要消掉的冲突。
export { default as WorkspaceFilesPlugin } from "@deepseek-ai/dsh-api-workspace-files";
// remote 面同样收在这里：别的域（sandbox 的 `workspaceFiles` 行）要登记它就是这条导入，
// 不直连上游包——同一个上游包被两个域直接 import 就是那条要消掉的冲突。
export { default as WorkspaceFilesRemote } from "@deepseek-ai/dsh-api-workspace-files/remote";
export type {
  WorkspaceByteRange,
  WorkspaceByteReadOptions,
  WorkspaceFileRange,
  WorkspaceFileScope,
  WorkspaceFileWatchFrame,
} from "@deepseek-ai/dsh-api-workspace-files";
