// 「会话组」 的方法面（浏览器侧）：只声明本包 UI 会调的那几条。
//
// `session` 组的 descriptor 由会话域的客户端形态 `SessionEndpointClient` 在它的 `onInit` 里挂；
// 方法名与 wire 参数名（`request`）由上游 descriptor 决定；这里按同一形状声明，供 `SessionController` 的
// 会话面转发时取类型。`Remote.workspace` 那次用的是同一手法（declaration merging）。
// 面（`remote.<组>`）是**客户端面**：`faceOf` 统一把裸值包成上游 `RemoteResult`（成功 `{ok,value}`、
// 失败 `{ok,error}`）。所以这里用上游协议类型，不用本仓的 `RemoteResultWire`——后者是自研端点那一侧
// 的手写包装，口径已经开始分叉（见 `packages/agent/dsh-session/.agents/debts/`）。
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type {
  SessionCancelRequest,
  SessionCancelValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from "@morlay/dsh-session/endpoint";

/** 「会话组」 的方法面。 */
export interface SessionRemoteFace {
  prompt(
    request: SessionPromptRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SessionPromptValue>>;
  cancel(request: SessionCancelRequest): Promise<RemoteResult<SessionCancelValue>>;
  updateQueue(request: SessionUpdateQueueRequest): Promise<RemoteResult<SessionUpdateQueueValue>>;
  rename(request: SessionRenameRequest): Promise<RemoteResult<SessionRenameValue>>;
}

declare module "@morlay/zephyr-app/client" {
  interface Remote {
    /** `session` namespace：由 `SessionEndpointClient` 的 `onInit` `$mount` 后才有值。 */
    readonly session?: SessionRemoteFace;
  }
}