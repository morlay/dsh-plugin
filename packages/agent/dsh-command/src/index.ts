// command 的包根：契约 + 默认实现 + 装配模块 + 贡献的声明式登记（聚合 `./contract`）。
//
// 两半各有出口：宿主半 `./server`（RPC 契约与实现、同进程端口实现），浏览器半 `./ui`（store / 位置 / 视图）。
export * from "./contract/index.ts";
export * from "./command-registry.service.ts";
export * from "./command.decorator.ts";
