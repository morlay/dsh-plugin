// `remote` 的最小装配：只装「Remote 的实现 + client 绑定」，不含任何 UI / 布局 / 主题。
//
// 业务包要在自己的测试里闭环（例如 `dsh-session` 验「建会话 → 事件 → store」），
// 需要的是这一块而不是整条 `ClientChainModule`（那条要浏览器 DOM）。
import { provide } from "@morlay/zephyr";
import { SessionRemoteBinding } from "./session-remote.client.ts";
import { SessionRemoteDefault } from "./session-remote.ts";
import { RemoteDefault } from "./remote.service.ts";

/** Remote 契约的实现与 client 绑定（`$mount` 由 `SessionRemoteBinding` 负责）。 */
export const provideClientRemote = provide([RemoteDefault, SessionRemoteDefault, SessionRemoteBinding]);
