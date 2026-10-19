// session 的 **RPC 面**（`@morlay/dsh-session/endpoint`）：组契约 + wire 端点名 + 请求/响应形状。
//
// 与 `contract/` 的分界：那里是**端口**（进程内的服务面）；这里是**远程面**（`@RemoteGroup` 的组契约、
// wire 上的方法名与形状）。宿主侧实现它，浏览器侧按它消费——同一份声明。
export * from "./session-endpoint.ts";
export * from "./session-id.ts";
