import { configure, provide } from "@morlay/zephyr";
import { AgentDirectoryDefault } from "./agent-directory.service.ts";
import { LlmDefault } from "./llm.service.ts";
import { SystemPromptDefault } from "./system-prompt.service.ts";
import { AgentDefaultModelDefault } from "./agent-default-model.service.ts";
import { LlmRetry } from "./llm-retry.service.ts";
import { LaunchEnvironmentDefault } from "./launch-environment.service.ts";
import { TimerDefault } from "./timer.service.ts";
import { ToolRegistryDefault } from "./tool-registry.service.ts";

// **agent 的骨架装配面**。
//
// 默认配置走 `provide` 的第二个参数（`configure(...)`）：不写成 `{ provide, config }` 的清单条目——
// 那样实现类的 `static Config` 与 `configure` 的类型推导都丢了。
//
// 循环期（循环本体、执行器、检查点、输出与调用策略、子代理派生）在
// `@morlay/dsh-agent-loop` 的 `provideAgentLoop()`；装配面分两段装，最小装配才成立。
// 顺序即装配顺序：适配行的契约面在它自己的 `onInit` 之后才就位。
export const provideAgent = provide(
  [
    AgentDirectoryDefault,
    LlmDefault,
    // 这两条要 `configure` 给的默认值：类必须先在清单里——`configure` 只替换**既有**条目。
    SystemPromptDefault,
    AgentDefaultModelDefault,
    ToolRegistryDefault,
    TimerDefault,
    LaunchEnvironmentDefault,
    LlmRetry,
  ],
  [
    configure(SystemPromptDefault, { personaPrefix: "" }),
    configure(AgentDefaultModelDefault, {
      provider: "deepseek-official",
      model: "deepseek-flash",
    }),
  ],
);
