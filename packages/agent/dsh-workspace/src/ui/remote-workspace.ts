// 「工作区组」 这一组面的**类型补声明**：给 `Remote` 补一条 namespace 声明。
//
// 上游把每个 namespace 声明在合并面 `TypertRemoteNamespaceMap` 上（`workspace-controller` 的
// `lib/typert.remote-client.ts`），我们的 `Remote` 契约刻意不列举 namespace（那是 service locator）。
// 本包是 workspace 这一个 namespace 的唯一消费方，所以按上游同一手法在这里补**这一条**声明；
// 运行时由 `RemoteDefault` 的 Proxy 在 `$mount` 登记后兑现。
//
// 转发**不在这里**：消费方调契约的客户端形态（`WorkspaceEndpointClient`），它按
// `remoteGroupNameOf(契约类)` 派生组名、每次调用才解析面。这份声明只留给按上游形态读
// `remote.workspace` 的既有调用点（`zephyr-app` 的 follow 链路用例）。
import type { WorkspaceRemote } from "@deepseek-ai/dsh-api-workspace-controller/client";

declare module "@morlay/zephyr-app/client" {
  interface Remote {
    /** `workspace-controller` 的 typert 绑定；`whenNamespace("workspace")` 之后才存在。 */
    readonly workspace?: WorkspaceRemote;
  }
}
