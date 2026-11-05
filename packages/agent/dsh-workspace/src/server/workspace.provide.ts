import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { DefaultWorkspace } from "../default-workspace.service.ts";
import { DirectoryPickerControllerRow } from "./directory-picker.host.ts";
import { DirectoryPickerNative } from "../directory-picker.service.ts";
import { SessionWorkspaceHost } from "./session-workspace.host.ts";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
import { WorkspaceControllerRow } from "./workspace-controller.host.ts";
import { Workspace } from "../workspace.service.ts";

// 工作区域的装配面：注册表 + 目录选择（backend 先于它的 wire 行）+ `remote.workspace` 的三条 host 行。
export const provideWorkspace = provide([
  Workspace,
  DirectoryPickerNative,
  DirectoryPickerControllerRow,
  // `workspace/follow` 的帧来源：命令与「会话 attach」都往它推。
  WorkspaceBroadcaster,
  // `remote.workspace` 的宿主面：上游 `WorkspaceController` + 本仓的 wire 路由表。
  WorkspaceControllerRow,
  // 「会话落在哪个目录 / 挂到哪个 workspace」：要在 `SessionControllerHost` 之前就位。
  SessionWorkspaceHost,
  // 默认工作区 = 启动目录（幂等）。会话创建只认已注册的工作区，这一步是"至少有一个可选"的来源。
  DefaultWorkspace,
  remoteDescriptor(() => import("@deepseek-ai/dsh-api-workspace-controller/remote")),
]);
