import { Module } from "@morlay/zephyr";
import { UiWorkflowRun } from "./workflow.client.service.ts";

@Module({ providers: [UiWorkflowRun] })
export class WorkflowClientModule {}
