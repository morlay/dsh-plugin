// `session` 组的 **wire 描述符**：上游 `@deepseek-ai/dsh-api-session-controller` 的 codegen（`TYPERT_REMOTE`）。
//
// 这一组只有**一个**来源：端点声明属于上游控制器（宿主侧实现就是它，见
// `dsh-conversation` 的 `ApiSessionControllerHost`）。客户端形态 `SessionEndpointClient` 拿它 `$mount`，
// 宿主侧 `MuxServer` 读它判端点载具（`typert.remotes.get(endpoint)?.mode`：流式必须走 stream 通道）。
//
// 为什么**不再**从我们自己的组契约编译描述符（`remoteDescriptorsOf(SessionEndpoint)`）：那会造出第二份
// wire 声明，而两份对不上时只有运行时才炸——`session/list` 就是实例：上游形参名是 `_request`
// （整组 26 条里唯一带下划线的），我们编译出来的却是 `request`，宿主 gateway 回
// `args fields do not match the descriptor: unexpected "request"`。
//
// 归位在会话域（这里）而不是对话域：组契约就在本域，依赖方向是「会话域知道上游端点包」。
export { TYPERT_REMOTE as SESSION_CONTROLLER_REMOTE } from "@deepseek-ai/dsh-api-session-controller/remote";
