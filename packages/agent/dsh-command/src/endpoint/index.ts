// command 的 **RPC 面**（`@morlay/dsh-command/endpoint`）：组契约 + 端点名 + 请求/响应形状。
//
// 与 `contract/` 的分界：那里是**进程内端口**（随包根导出）；这里是**两端共用面**
// （`@RemoteGroup` 的组契约、wire 上的方法名与形状，以及浏览器半也要用的只读契约）。
export * from "./command-endpoint.ts";
// 浏览器半要消费的两个只读端口与条目形状：放这里，ui 面就不必引包根。
export * from "../contract/command-catalog.contract.ts";
export * from "../contract/command-entry.ts";
export * from "../contract/command-runner.contract.ts";
