import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { WorkspaceFilesDefault } from "./workspace-files.service.ts";
import { WorkspaceFilesEndpointRow } from "./workspace-files-endpoint.service.ts";
import { WorkspaceFilesRemote } from "./workspace-files.face.ts";

// `remote.workspaceFiles` 的宿主面：上游 `WorkspaceFiles`（读 / 列 / 观察）+ 五条 wire 端点。
//
// `remote.workspaceFiles` 的宿主面：上游 `WorkspaceFiles`（读 / 列 / 观察）+ 五条 wire 端点。
//
// 它是 workspace 的**面**（owning 的是 `@deepseek-ai/dsh-api-workspace-files`），所以住在 workspace 域。
// 要喂给上游的 `sandboxPolicy` 来自沙箱域——依赖方向是 `workspace → sandbox` 单向（沙箱不认识 workspace）。
export const provideWorkspaceFiles = provide([
  // 「装上游」与「接 wire」是两行：前者发布上游的读/列/观察面，后者继承契约、把它接到 wire 上。
  WorkspaceFilesDefault,
  WorkspaceFilesEndpointRow,
  // remote 的面就在本包（上游包只有一个本地 owner：workspace）。
  remoteDescriptor(async () => ({ default: WorkspaceFilesRemote })),
]);
