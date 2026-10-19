import { provide, type ProviderList, configure } from "@morlay/zephyr";
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

const providers = (): ProviderList => [
  AgentDirectoryDefault,
  LlmDefault,
  ToolRegistryDefault,
  TimerDefault,
  LaunchEnvironmentDefault,
  ToolExecutorNative,
  configure(SystemPromptDefault, { personaPrefix: "" })([SystemPromptDefault]),
  configure(AgentDefaultModelDefault, { provider: "deepseek-official", model: "deepseek-flash" })([AgentDefaultModelDefault]),
  LlmRetry,
  configure(AgentLoopDefault, { agents: [] })([AgentLoopDefault]),
];

export const provideAgent = provide(providers());
