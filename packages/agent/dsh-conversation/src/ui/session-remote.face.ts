// 「会话组」 的方法面（浏览器侧）：只声明本包 UI 会调的那几条。
//
// `session` 组的 descriptor 由会话域的客户端形态 `SessionEndpointClient` 在它的 `onInit` 里挂；
// 方法名与 wire 参数名（`request`）由上游 descriptor 决定；这里按同一形状声明，供 `SessionController` 的
// 会话面转发时取类型。`Remote.workspace` 那次用的是同一手法（declaration merging）。
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";
import type {
  SessionAcceptedValue,
  SessionCancelRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionUpdateQueueRequest,
} from "@morlay/dsh-session/endpoint";

/** 「会话组」 的方法面。 */
export interface SessionRemoteFace {
  prompt(
    request: SessionPromptRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResultWire<SessionPromptValue>>;
  cancel(request: SessionCancelRequest): Promise<RemoteResultWire<SessionAcceptedValue>>;
  updateQueue(request: SessionUpdateQueueRequest): Promise<RemoteResultWire<SessionAcceptedValue>>;
  rename(request: SessionRenameRequest): Promise<RemoteResultWire<SessionRenameValue>>;
}

declare module "@morlay/zephyr-app/client" {
  interface Remote {
    /** `session` namespace：由 `SessionEndpointClient` 的 `onInit` `$mount` 后才有值。 */
    readonly session?: SessionRemoteFace;
  }
}
