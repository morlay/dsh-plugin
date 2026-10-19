import { Module, type ProviderList } from "@morlay/zephyr";
import { AgentsDefault } from "./agents.service.ts";
import { SystemPromptDefault } from "./system-prompt.service.ts";
import { AgentDefaultModelDefault } from "./agent-default-model.service.ts";
import { LlmRetry } from "./llm-retry.service.ts";
import { AgentLoopDefault } from "./agent-loop.service.ts";
import { ToolsDefault } from "./tools.service.ts";

const providers = (): ProviderList => [
  AgentsDefault,
  ToolsDefault,
  SystemPromptDefault.withConfig({ personaPrefix: "" }),
  AgentDefaultModelDefault.withConfig({ provider: "deepseek-official", model: "deepseek-flash" }),
  LlmRetry,
  AgentLoopDefault.withConfig({ agents: [] }),
];

@Module({ providers: providers() })
export class AgentModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
