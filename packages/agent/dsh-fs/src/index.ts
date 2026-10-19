// fs 域的包根：`FileSystem` 契约（进程内端口）。
//
// 实现不在本包：它要 `SandboxPolicy` 才能 mount，住在沙箱域的行里（`@morlay/dsh-sandbox` 的 `FsSandbox`）。
// 消费方从这里取契约；`./endpoint` 只用于两端共用的声明（本包没有 remote 面，所以那条出口不开）。
export * from "./contract/index.ts";
