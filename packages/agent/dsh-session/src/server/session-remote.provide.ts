import { provide } from "@morlay/zephyr";
import { provideSessionProjection } from "./session-projection.provide.ts";
import { provideSessionQuerySqlite } from "./session-query.provide.ts";
import { provideSession } from "./session.provide.ts";
import { ToolResultsDefault } from "./tool-results.service.ts";

// 上游 wire 的宿主行：`remote.session`（`SessionController`）、`remote.schedule`（`ScheduleService`），
// 外加 `remote.toolResults`（`ui-trajectory` 的 host 入口）与 `remote.fileReferences`（输入框 `@` 的文件候选）。
// `remote.skills`（`SessionSkillCatalog`）是技能域的面，随 `dsh-skill` 的装配装。
// 它们要 agent / 附件 / 上传 / 工作区 / working-directory / storage domain 那一整套服务，
// 所以单独成清单，由应用装配显式装上。
//
// **自带它读的三份 root**（真 store / 投影 / 查询）：装配面只装这一面，不必再单列那三个。
export const provideSessionRemote = provide([
  ...provideSession(),
  ...provideSessionProjection(),
  ...provideSessionQuerySqlite(),
  // `session` 组与 `fileReferences` 组的端点由 `provideApiSession()` 提供（上游实现）。
  // 它**不在这里**：`api-session.provide.ts` 依赖 agent / attachment 等域的实现包，直接 import 会与本
  // 文件形成循环（`provideApiSession is not iterable`）。装配面显式并列装上这两份清单即可。
  ToolResultsDefault,
]);
