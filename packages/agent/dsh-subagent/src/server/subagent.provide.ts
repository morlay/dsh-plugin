import { provide } from "@morlay/zephyr";
import { SubagentRegistryDefault } from "../subagent-registry.service.ts";
import { SubagentsEndpointDefault } from "./subagents-endpoint.ts";
import { SubagentSpawnInProcess } from "../spawn-in-process.service.ts";
import { SubagentForkInProcess } from "../fork-in-process.service.ts";
import { ToolSubagentControl } from "../tool-control.service.ts";
import { ToolSubagent } from "../tool-subagent.service.ts";
import { ToolSubagentFork } from "../tool-subagent-fork.service.ts";

export const provideSubagent = provide([
  SubagentRegistryDefault,
  // `remote.subagents` 的两条 wire 端点（`endpoint/` 契约的宿主实现，转发到上面那条运行时）。
  SubagentsEndpointDefault,
  { provide: SubagentSpawnInProcess, config: { providerName: "spawn" } },
  { provide: SubagentForkInProcess, config: { providerName: "fork" } },
  ToolSubagentControl,
  { provide: ToolSubagent, config: { provider: "spawn", toolName: "subagent" } },
  { provide: ToolSubagentFork, config: { provider: "fork", toolName: "subagent_fork" } },
]);
