import { Module } from "@morlay/zephyr";
import { UiAgentPreset } from "./agent.client.service.ts";

@Module({ providers: [UiAgentPreset] })
export class AgentClientModule {}
