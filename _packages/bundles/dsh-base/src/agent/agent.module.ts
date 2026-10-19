import { Module, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { AgentsDefault } from "./agents.service.ts";
import { SystemPromptDefault } from "./system-prompt.service.ts";
import { CredentialsDefault } from "./credentials.service.ts";
import { AuthorizationDefault } from "./authorization.service.ts";
import { DeepseekAccountDefault } from "./deepseek-account.service.ts";
import { AgentDefaultModelDefault } from "./agent-default-model.service.ts";
import { UserQuestionsDefault } from "./user-questions.service.ts";
import { LlmRetry } from "./llm-retry.service.ts";
import { AgentInstructions } from "./agent-instructions.service.ts";
import { AgentLoopDefault } from "./agent-loop.service.ts";

const providers = (): ProviderList => [
  AgentsDefault,
  SystemPromptDefault.withConfig({ personaPrefix: "" }),
  CredentialsDefault,
  AuthorizationDefault,
  DeepseekAccountDefault.withConfig({
    desktopPlatform: jsExpr(
      (ctx) =>
        ctx.get("profileContext")?.name === "desktop" &&
        ["darwin", "win32"].includes(process.platform)
          ? (process.platform as "darwin" | "win32")
          : null,
    ),
  }),
  AgentDefaultModelDefault.withConfig({ provider: "deepseek-official", model: "deepseek-flash" }),
  UserQuestionsDefault,
  LlmRetry,
  AgentInstructions.withConfig({ maxBytes: 65536 }),
  AgentLoopDefault.withConfig({ agents: [] }),
];

@Module({ providers: providers() })
export class AgentModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
