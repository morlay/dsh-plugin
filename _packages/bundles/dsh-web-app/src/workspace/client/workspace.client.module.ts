import { Module } from "@morlay/zephyr";
import { UiWorkspace } from "./workspace.client.service.ts";

@Module({ providers: [UiWorkspace] })
export class WorkspaceClientModule {}
