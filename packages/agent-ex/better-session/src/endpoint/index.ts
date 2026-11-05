// better-session 的 **RPC 面**（`@morlay/better-session/endpoint`）：组契约 + 两端共用的请求/响应形状 +
// 分支面的契约与配平算法。
//
// 与 `contract/` 的分界：那里是**进程内端口**（随包根导出）；这里是**远程面**与两端共用的值/类型。
// 浏览器半（`./ui`）只从这里取，不引包根——包根聚合了宿主实现。
export * from "./branch.ts";
export * from "./session-admin-endpoint.ts";
export * from "./session-editor-endpoint.ts";
// 分支面的两类导出：契约（数据层原语，实现方在 `./server`）与配平算法（两端都要的纯函数）。
export * from "../contract/session-branch.contract.ts";
export * from "./balance.ts";
