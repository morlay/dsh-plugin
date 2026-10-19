import { Module } from "@morlay/zephyr";
import { Workspace, WorkspaceChanges, WorkspaceController, WorkspaceFiles } from "./workspace.service.ts";

@Module({ providers: [Workspace, WorkspaceFiles, WorkspaceController, WorkspaceChanges] })
export class WorkspaceModule {}
