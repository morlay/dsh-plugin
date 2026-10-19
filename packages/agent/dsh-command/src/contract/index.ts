// command 的**契约面**（`@morlay/dsh-command/contract`）：进程内的端口。
//
// 注册表 / 目录 / 执行器 / 按会话取 agent —— 全是进程内的服务面，**不涉及 remote**；
// 远程面在 `./endpoint`。
export * from "./command-entry.ts";
export * from "./command-contribution.ts";
export * from "./command-registry.contract.ts";
export * from "./command-catalog.contract.ts";
export * from "./command-runner.contract.ts";
