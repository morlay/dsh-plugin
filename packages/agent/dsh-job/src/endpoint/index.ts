// job 的**远程面**（`@morlay/dsh-job/endpoint`）：组契约 + 端点名 + 请求/响应形状。
//
// 与 `contract/` 的分界：那里是进程内的端口（注册表）；这里是 `@RemoteGroup` 的组契约。
export * from "./job-endpoint.ts";
