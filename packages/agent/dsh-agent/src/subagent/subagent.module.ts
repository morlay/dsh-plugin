import { Module, type ProviderList } from "@morlay/zephyr";
import { SubagentsDefault } from "./subagents.service.ts";
import { SubagentSpawnInProcess } from "./spawn-in-process.service.ts";
import { SubagentForkInProcess } from "./fork-in-process.service.ts";
import { ToolSubagentControl } from "./tool-control.service.ts";
import { ToolSubagentListAgents } from "./tool-list-agents.service.ts";
import { ToolSubagent } from "./tool-subagent.service.ts";
import { ToolSubagentFork } from "./tool-subagent-fork.service.ts";

const providers = (): ProviderList => [
  SubagentsDefault,
  SubagentSpawnInProcess.withConfig({ providerName: "spawn" }),
  SubagentForkInProcess.withConfig({ providerName: "fork" }),
  ToolSubagentControl,
  ToolSubagentListAgents,
  ToolSubagent.withConfig({ provider: "spawn", toolName: "subagent" }),
  ToolSubagentFork.withConfig({ provider: "fork", toolName: "subagent_fork" }),
];

@Module({ providers: providers() })
export class SubagentModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
