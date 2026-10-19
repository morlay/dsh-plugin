import { Module } from "@morlay/zephyr";
import { UiSubagent } from "./subagent.client.service.ts";

@Module({ providers: [UiSubagent] })
export class SubagentClientModule {}
