import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { SubagentRegistryDefault } from "../subagent-registry.service.ts";
import { SubagentsEndpointDefault } from "./subagents-endpoint.ts";
import { SubagentSpawnInProcess } from "../spawn-in-process.service.ts";
import { SubagentForkInProcess } from "../fork-in-process.service.ts";
import { ToolSubagentControl } from "../tool-control.service.ts";
import { ToolSubagent } from "../tool-subagent.service.ts";
import { ToolSubagentFork } from "../tool-subagent-fork.service.ts";

const providers = (): ProviderList => [
  SubagentRegistryDefault,
  // `remote.subagents` 的两条 wire 端点（`endpoint/` 契约的宿主实现，转发到上面那条运行时）。
  SubagentsEndpointDefault,
  configure(SubagentSpawnInProcess, { providerName: "spawn" })([SubagentSpawnInProcess]),
  configure(SubagentForkInProcess, { providerName: "fork" })([SubagentForkInProcess]),
  ToolSubagentControl,
  configure(ToolSubagent, { provider: "spawn", toolName: "subagent" })([ToolSubagent]),
  configure(ToolSubagentFork, { provider: "fork", toolName: "subagent_fork" })([ToolSubagentFork]),
];

export const provideSubagent = provide(providers());
