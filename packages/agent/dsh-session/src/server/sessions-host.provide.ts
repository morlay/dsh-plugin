import { provide } from "@morlay/zephyr";
import { SessionControllerHost } from "./session-controller.host.ts";
import { SessionStoreDefault } from "../session.service.ts";

// `remote.session` 的**会话宿主服务**面：只装 `SessionControllerHost`（列表 / 建会话 / follow 的宿主表）。
// 上游 wire 行（`SessionController`、`SessionSkillCatalog`）的依赖横跨 agent、附件、上传、工作区与
// working-directory，放在 `provideSessionRemote()` 里，避免任何只想要宿主表的装配被迫装半个应用。
export const provideSessionsHost = provide([
  // 会话宿主读真 store：`get` / `list` 都从这里来（`provideSession()` 也装它，装配期按令牌去重）。
  SessionStoreDefault,
  SessionControllerHost,
]);
