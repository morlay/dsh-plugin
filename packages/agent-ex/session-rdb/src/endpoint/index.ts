// better-session 的 **RPC 面**（`@morlay/session-rdb/endpoint`）：组契约 + 两端共用的请求/响应形状 +
// 分支面的契约与配平算法。
//
// 与 `contract/` 的分界：那里是**进程内端口**（随包根导出）；这里是**远程面**与两端共用的值/类型。
// 浏览器半（`./ui`）只从这里取，不引包根——包根聚合了宿主实现。
// 域码是两端共用的**稳定面**（浏览器半的文案映射按码分派）：形状家在 `contract/`，这里转出一份。
export type { SessionStoreFailure } from "../contract/session-failure.contract.ts";
export * from "./branch.ts";
export * from "./session-admin-endpoint.ts";
export * from "./session-editor-endpoint.ts";
// 分支面的配平算法（两端都要的纯函数）在这里；**契约本身**（`SessionBranch` 等数据层原语）走
// `@morlay/session-rdb/contract`——在这里转出等于给同一批符号造第二个 home。
export * from "./balance.ts";
