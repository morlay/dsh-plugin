// command 的**宿主半**（`@morlay/dsh-command/server`）：
//   `CommandEndpointDefault` 实现 `endpoint/` 的组契约并注册到 wire；
//   `RegistryCatalog` / `RegistryRunner` 是同进程直连注册表的端口实现（单机模式、集成测试）。
export { CommandEndpointDefault } from "./command-endpoint.service.ts";
export { RegistryCatalog } from "./registry-catalog.ts";
export { RegistryRunner } from "./registry-runner.ts";
export { provideCommand } from "./command.provide.ts";

// 上游门面：**只出被消费的**三个类型（`command-entry-of.ts`、`contract/command-contribution.ts` 与它们的
// spec 从这里取类型）。上游其余符号（`CommandId` / `CommandDefinitionId` / `parseCommand` / `name` …）
// 没有消费方，不再整包透传——要用的人直接引 `@deepseek-ai/dsh-commands`。
export type {
  CommandDescriptor,
  CommandInvocation,
  CommandResult,
} from "@deepseek-ai/dsh-commands";
