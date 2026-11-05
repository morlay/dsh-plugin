import { provide } from "@morlay/zephyr";
import { SessionStoreDefault } from "../session.service.ts";

// `remote.session` 的**会话存储**面：只装真 store（`get` / `list` 都从这里来）。
// 端点由上游 `SessionController` 那一族行提供，见 `provideSessionRemote()`。
export const provideSessionsHost = provide([SessionStoreDefault]);
