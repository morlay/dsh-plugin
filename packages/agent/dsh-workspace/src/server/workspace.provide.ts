import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { DefaultWorkspace } from "../default-workspace.service.ts";
import { DirectoryPickerNative } from "../directory-picker.service.ts";
import { SessionWorkspaceCopyHost } from "./session-workspace-copy.host.ts";
import { SessionWorkspaceHost } from "./session-workspace.host.ts";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
import { WorkspaceControllerRow } from "./workspace-controller.host.ts";
import { WorkspaceRemoteHost } from "./workspace-remote.host.ts";
import { Workspace } from "../workspace.service.ts";

// 工作区域的装配面：注册表 + 目录选择 backend + `workspace`/`directoryPicker` 两个 remote 组的上游行。
export const provideWorkspace = provide([
  Workspace,
  // 目录选择的 backend（上游 `NativeDirectoryPicker` 的 `directoryPicker` 服务）：上游
  // `WorkspaceController` 内部装的 `DirectoryPickerController` 读它。
  DirectoryPickerNative,
  // `remote.workspace` 的宿主面：上游 `WorkspaceController`（`static inject` 要 `remoteAccess` /
  // `typert` / `workspaceRegistry`）。它同时装 `directoryPicker` 那一组，所以清单里不再有
  // `DirectoryPickerControllerRow` / `DirectoryPickerEndpointRow`（同一个上游类装两次是同名服务重复注册）。
  WorkspaceRemoteHost,
  // `workspace/follow` 的帧来源：自研端点行（`WorkspaceControllerRow`）用；上游 `follow` 自带
  // `WorkspaceFeed`，不读它。票 02 收编自研端点后这条一起删。
  WorkspaceBroadcaster,
  WorkspaceControllerRow,
  // 「会话落在哪个目录 / 挂到哪个 workspace」：要在 `SessionControllerHost` 之前就位。
  SessionWorkspaceHost,
  // 「把一条会话复制到目标工作区」的编排：注入 `SessionWorkspace`（上一行）与 `SessionBranching`
  // （数据面给的分支原语）。跨域动作住在编排层，持久化行不认识 workspace。
  SessionWorkspaceCopyHost,
  // 默认工作区 = 启动目录（幂等）。会话创建只认已注册的工作区，这一步是"至少有一个可选"的来源。
  DefaultWorkspace,
  remoteDescriptor(() => import("@deepseek-ai/dsh-api-workspace-controller/remote")),
]);
