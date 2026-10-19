import { Module } from "@morlay/zephyr";
import { SubagentModelSelectionSettings } from "./subagent.service.ts";

@Module({ providers: [SubagentModelSelectionSettings] })
export class SubagentModule {}
