import { Module } from "@morlay/zephyr";
import { AgentPresetsMock } from "./agent-presets.mock.ts";

@Module({ providers: [AgentPresetsMock] })
export class AgentPresetModule {}
