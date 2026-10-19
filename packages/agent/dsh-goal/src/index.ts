// goal 域的包根：契约 + 状态机行 + 续跑驱动行 + 命令行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./goal.service.ts";
export * from "./round-driver.service.ts";
export * from "./command.service.ts";
export * from "./server/tool-goal.service.ts";
