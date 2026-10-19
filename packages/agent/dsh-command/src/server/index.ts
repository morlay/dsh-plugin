// command 的**宿主半**（`@morlay/dsh-command/server`）：
//   `CommandEndpointDefault` 实现 `endpoint/` 的组契约并注册到 wire；
//   `RegistryCatalog` / `RegistryRunner` 是同进程直连注册表的端口实现（单机模式、集成测试）。
export { CommandEndpointDefault } from "./command-endpoint.service.ts";
export { RegistryCatalog } from "./registry-catalog.ts";
export { RegistryRunner } from "./registry-runner.ts";
export { provideCommand } from "./command.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-commands`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-commands";
