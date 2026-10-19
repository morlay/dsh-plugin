import { provide } from "@morlay/zephyr";
import { ScheduleRow } from "./schedule.service.ts";
import { SessionControllerRow } from "./session-controller.row.ts";
import { provideSessionProjection } from "./session-projection.provide.ts";
import { provideSessionQuerySqlite } from "./session-query.provide.ts";
import { provideSession } from "./session.provide.ts";
import { FileReferencesDefault } from "./file-references.service.ts";
import { SessionEndpointDefault } from "./session-endpoint.service.ts";
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
  SessionControllerRow,
  // `remote.session` 的 8+ 个端点（rename / selectModel / fork / search / prompt / cancel / updateQueue …）：
  // 装饰器注册，组名沿契约基类取。没有这一行，客户端调 `session/prompt` 就是「没有实现」。
  SessionEndpointDefault,
  ScheduleRow,
  ToolResultsDefault,
  // `fileReferences/list`：上游 `WorkspaceFileSearch` + wire 端点。缺了它，`@` 的文件候选
  // 就是 `[remote] fileReferences/list 没有实现`。
  FileReferencesDefault,
]);
