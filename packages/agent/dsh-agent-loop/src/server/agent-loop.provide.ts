import { configure, provide } from "@morlay/zephyr";
import { AgentLoopDefault } from "../agent-loop.service.ts";
import { provideSessionCheckpointPolicy } from "./checkpoint-policy.provide.ts";
import { provideToolOutput } from "./tool-output.provide.ts";
import { provideToolPolicy } from "./tool-policy.provide.ts";
import { provideSubagentEndpoints } from "./subagent.provide.ts";
import { ToolExecutorNative } from "../tool-executor.service.ts";

/**
 * agent 的**循环期装配面**：一轮里才发生的事——循环本体、执行器、检查点、输出与调用策略、子代理派生。
 *
 * 与 `provideAgent()` 分开（最小装配原则）。执行器只有一个（上游 `setExecutor` 在根作用域互斥）：
 * 本部署选 PTC 时用 `provideAgentLoop(without(ToolExecutorNative))` 剔掉这一条。
 * @returns `(...features) => 条目清单`。
 */
export const provideAgentLoop = provide(
  [
    ToolExecutorNative,
    ...provideSessionCheckpointPolicy(),
    ...provideToolOutput(),
    ...provideToolPolicy(),
    ...provideSubagentEndpoints(),
  ],
  // 默认配置走 `configure`（保证类型推导），不写成清单里的 `{ provide, config }`。
  [configure(AgentLoopDefault, { agents: [] })],
);
