import { provide } from "@morlay/zephyr";
import { SessionBranchRdb } from "../rdb/branch/index.ts";
import { SessionProjectionCacheRdb } from "../rdb/storage-takeover/projection-cache.service.ts";
import { StorageTakeoverDefault } from "../rdb/storage-takeover/storage-takeover.service.ts";
import { SessionPersistenceRdb } from "../rdb-store.service.ts";
import { SessionEditorEndpointDefault } from "./session-editor-endpoint.service.ts";
import { SessionEditorDefault } from "../session-editor.service.ts";
import { SessionQueryRdb } from "../session-query.service.ts";
import { SessionAdminEndpointDefault } from "./session-admin-endpoint.service.ts";
import { SessionAgentControlDefault } from "./session-agent-control.service.ts";

/**
 * 会话这一面：RDB 落盘、storage KV 后端接管、分支、查询、编辑编排与两组 wire 端点。
 *
 * **一个面一个函数**：行清单在这里写全，装配面只写这一句。要改哪条行的配置用 `configure(实现类, …)`，
 * 要剔哪条用 `without(实现类)`——那是调用方的 feature，不是清单的事（zephyr 的 `provide(list, [defaults])`
 * 就是为这件事存在的）。
 *
 * 顺序即依赖：
 * - 持久化最前：storage 接管、投影检查点、分支、查询、编辑全都读它；
 * - storage 接管紧随：它按 `sessionPersistence.storageRepository()` 拿**同一个库**的句柄；
 * - 投影检查点排在接管之后：检查点行与 KV 域落同一个库（撤回按水位截断缓存要跨得起来）；
 * - 两组端点最后：它们只转发到上面那些实现。
 */
export const provideBetterSession = provide([
  SessionPersistenceRdb,
  // KV 域（workspace / session_projcache …）也落进同一个库：不装它，`<dataDir>/storages/*.json`
  // 会继续被创建与写入。它要 `ctx.storage` 那个 hub，装配面同时装 `provideStorage()`；
  // 测试用 `provideBetterSession(without(StorageTakeoverDefault))` 剔掉。
  StorageTakeoverDefault,
  // 投影检查点（`sessionProjectionCache`）：列表页的零 I/O 快照、冷读的 fold 种子、撤回后的截断。
  // 上游按驼峰读这个名字（`@Injectable({ name })` 别名），所以它与 KV 版契约不同名，可并存但不该并存
  // ——检查点必须与会话日志同库（KV 版是 json 后端时代的第二条写路径）。
  SessionProjectionCacheRdb,
  SessionBranchRdb,
  SessionQueryRdb,
  // 运行中 agent 的目录面：编辑编排「先停 agent、再把用户输入排进重放队列」靠它。
  // 必须排在编辑行**之前**：编辑行装配期注入的这份引用不会随晚挂载的行更新。
  SessionAgentControlDefault,
  SessionEditorDefault,
  // wire 端点跟着这一面走：它们只转发到上面的实现，分开装只会多一个漏装的机会。
  SessionEditorEndpointDefault,
  SessionAdminEndpointDefault,
]);
