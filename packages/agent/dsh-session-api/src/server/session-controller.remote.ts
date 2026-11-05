// 会话控制器包的**调用描述**（上游 codegen 的 `TYPERT_REMOTE`）。
//
// 服务端要靠它判断端点的载具：`MuxServer` 读 `typert.remotes.get(endpoint)?.mode`，
// 流式（`mode: 'stream'`）必须走 gateway 的 stream 通道，否则上游会拒
// `stream Remote methods must be opened through the stream carrier`。
//
// 依赖面说明：这是**业务包**引用它自己领域的 codegen，不是框架层依赖业务。
export { TYPERT_REMOTE as SESSION_CONTROLLER_REMOTE } from "@deepseek-ai/dsh-api-session-controller/remote";
