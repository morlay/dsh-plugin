import { provide } from "@morlay/zephyr";
import { SubagentRegistryDefault } from "@morlay/dsh-agent";
import { SubagentSpawnInProcess } from "./spawn-in-process.service.ts";
import { SubagentForkInProcess } from "./fork-in-process.service.ts";
import { ToolSubagentControl } from "./subagent-control.tool.ts";
import { ToolSubagent } from "./subagent.tool.ts";
import { ToolSubagentFork } from "./subagent-fork.tool.ts";

/**
 * **headless 子代理**：注册表 + 两种运行方式 + 三条工具行。
 *
 * 不含 `remote.subagents` 的 wire 端点——那是 `provideSubagentEndpoints()`。
 */
export const provideSubagent = provide([
  SubagentRegistryDefault,
  { provide: SubagentSpawnInProcess, config: { providerName: "spawn" } },
  { provide: SubagentForkInProcess, config: { providerName: "fork" } },
  ToolSubagentControl,
  { provide: ToolSubagent, config: { provider: "spawn", toolName: "subagent" } },
  { provide: ToolSubagentFork, config: { provider: "fork", toolName: "subagent_fork" } },
]);
