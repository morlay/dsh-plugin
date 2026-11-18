// command 的 **RPC 面**（`@morlay/dsh-command/endpoint`）：组契约 + 请求/响应形状。
//
// 与 `contract/` 的分界：那里是**进程内的端口**（`@morlay/dsh-command/contract`）；这里是**两端共用面**
// （`@RemoteGroup` 的组契约与 wire 形状）。
//
// 浏览器半要消费的那几个只读契约（`CommandCatalog` / `CommandEntry` / `CommandRunner`）**不在这里转出**：
// 它们本来就是契约面的东西，走 `@morlay/dsh-command/contract`——在这里 re-export 等于给同一批符号造
// 第二个 home，也让「跨面 `export * from "../contract/*"`」这条判据失效。
export * from "./command-endpoint.ts";
