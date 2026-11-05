// better-session 的**包根**：契约 + 默认实现 + 它们依赖的实现细节与纯函数。
//
// 规范：root 出「契约聚合 + 默认实现」（`dsh-workspace` / `dsh-skill` 同形）；装配函数在 `./server`
// （宿主半，只出服务相关的）与 `./ui`（浏览器半）；两端共用的形状在 `./endpoint`。
export * from "./contract/index.ts";
export { asRdbStore } from "./contract/session-rdb-store.contract.ts";

// 默认实现（同进程端口）：会话落盘 / storage KV 后端接管 / 分支 / 查询 / 编辑编排。
export { SessionPersistenceRdb, type RdbConfig } from "./rdb-store.service.ts";
export { SessionQueryRdb } from "./session-query.service.ts";
export { SessionEditorDefault } from "./session-editor.service.ts";
export { SessionBranchRdb } from "./rdb/branch/index.ts";
export { SessionProjectionCacheRdb } from "./rdb/storage-takeover/projection-cache.service.ts";

// 实现细节与纯函数：编辑计划、日志编解码、读视图修复、KV 域接管。
// 从源包搬来的 spec 直接引用这几件（源包的 `artifact.ts` / `backend.ts` 就是同一个位置）。
export * from "./plan.ts";
export {
  findSurfaceRepairs,
  needsShapeAdoption,
  normalizeToCurrentShape,
  orphanInboxSpliceSeqs,
  recomputeReplaceProvenance,
  repairAssistantSettlement,
  repairOrphanInboxSplices,
  repairReadView,
  syncMeteringRanges,
} from "./rdb/log/repair.ts";
export { scanRows, titleOfEventData, toJsonlArtifact } from "./rdb/log/export.ts";
export { rowToEvent, rowToMeta } from "./rdb/log/rows.ts";
export { eventDimensions } from "./rdb/event-shape.ts";
export { SESSION_PERSISTENCE_SQLITE_APPLICATION_ID } from "./rdb/version.ts";
export type { StorageRepository } from "./rdb/storage-takeover/types.ts";
export type { Backend, EventRow, SessionRow } from "./rdb/backend.ts";
export { WriteGuard } from "./rdb/write-guard.ts";
export {
  SessionBranchRdbProvider,
  locateTurnEnd,
  truncateLiveSession,
  liveEventsOf,
  replaceLiveSessionLog,
} from "./rdb/branch/index.ts";
export type { BranchPort } from "./rdb/branch/port.ts";
export { openRdbBackend } from "./rdb/db/open.ts";
export { DEFAULT_BUSY_TIMEOUT_MS, SCHEMA_VERSION, type JournalMode } from "./rdb/version.ts";
export { SessionDeletionError } from "./rdb/deletion-error.ts";
export { parseJsonlArtifact, parseImportZip } from "./rdb/log-import.ts";
export { StorageTakeoverDefault } from "./rdb/storage-takeover/storage-takeover.service.ts";
export {
  importStorages,
  PROJCACHE_UNIT_VERSIONS,
  WORKSPACE_UNIT_VERSIONS,
} from "./rdb/storage-takeover/import-storages.ts";
