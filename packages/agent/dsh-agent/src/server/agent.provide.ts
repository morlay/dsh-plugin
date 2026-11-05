import { provide } from "@morlay/zephyr";
import { AgentDirectoryDefault } from "./agent-directory.service.ts";
import { LlmDefault } from "./llm.service.ts";
import { SystemPromptDefault } from "./system-prompt.service.ts";
import { AgentDefaultModelDefault } from "./agent-default-model.service.ts";
import { LlmRetry } from "./llm-retry.service.ts";
import { AgentLoopDefault } from "./agent-loop.service.ts";
import { LaunchEnvironmentDefault } from "./launch-environment.service.ts";
import { TimerDefault } from "./timer.service.ts";
import { ToolExecutorNative } from "./tool-executor.service.ts";
import { ToolRegistryDefault } from "./tool-registry.service.ts";

// 顺序即装配顺序：适配行的契约面在它自己的 `onInit` 之后才就位，所以「被注入的行」必须排在
// 「注入它的行」前面（`ToolRegistry` 构造期就要 `SystemPrompt.tools()`、`ToolExecutor` 要 `ToolRegistry`）。
export const provideAgent = provide([
  AgentDirectoryDefault,
  LlmDefault,
  { provide: SystemPromptDefault, config: { personaPrefix: "" } },
  ToolRegistryDefault,
  ToolExecutorNative,
  TimerDefault,
  LaunchEnvironmentDefault,
  {
    provide: AgentDefaultModelDefault,
    config: { provider: "deepseek-official", model: "deepseek-flash" },
  },
  LlmRetry,
  { provide: AgentLoopDefault, config: { agents: [] } },
]);

