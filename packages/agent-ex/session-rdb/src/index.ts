// better-session 的**包根**：契约 + 默认实现 + 它们依赖的实现细节与纯函数。
//
// 规范：root 出「契约聚合 + 默认实现」（`dsh-workspace` / `dsh-skill` 同形）；装配函数在 `./server`
// （宿主半，只出服务相关的）与 `./ui`（浏览器半）；两端共用的形状在 `./endpoint`。
export * from "./contract/index.ts";
export { asRdbStore } from "./contract/session-rdb-store.contract.ts";

// 默认实现（同进程端口）：会话落盘 / storage KV 后端接管 / 分支 / 查询 / 编辑编排。
export { SessionPersistenceRdb, type RdbConfig } from "./admin/store.ts";
export { SessionQueryRdb } from "./admin/query.ts";
export { SessionEditorDefault } from "./editor/service.ts";
export { SessionBranchRdb } from "./data/store/branch/index.ts";
export { SessionBranchingRdb } from "./server/session-branching.service.ts";
export { SessionProjectionCacheRdb } from "./storage/projection-cache.service.ts";

// 实现细节与纯函数：编辑计划、日志编解码、读视图修复、KV 域接管。
// 从源包搬来的 spec 直接引用这几件（源包的 `artifact.ts` / `backend.ts` 就是同一个位置）。
export * from "./editor/plan.ts";
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
} from "./data/store/read-view/index.ts";
export { scanRows, titleOfEventData, toJsonlArtifact } from "./data/store/log/export.ts";
export { rowToEvent, rowToMeta } from "./data/store/log/rows.ts";
export { eventDimensions } from "./data/event-shape.ts";
export { SESSION_PERSISTENCE_SQLITE_APPLICATION_ID } from "./data/version.ts";
export type { StorageRepository } from "./contract/storage-repository.contract.ts";
export type { Backend, EventRow, SessionRow } from "./data/backend.ts";
export { WriteGuard } from "./data/write-guard.ts";
export {
  SessionBranchRdbProvider,
  locateTurnEnd,
  truncateLiveSession,
  liveEventsOf,
  replaceLiveSessionLog,
} from "./data/store/branch/index.ts";
export type { BranchPort } from "./data/store/branch/port.ts";
export { openRdbBackend } from "./data/store/open.ts";
export { DEFAULT_BUSY_TIMEOUT_MS, SCHEMA_VERSION, type JournalMode } from "./data/version.ts";
export {
  SessionStoreError,
  dbErrorOf,
  failureCodeOf,
  sessionStoreError,
  type SessionStoreFailure,
} from "./data/errors.ts";
export { parseJsonlArtifact, parseImportZip } from "./admin/import-export/parse.ts";
export { StorageTakeoverDefault } from "./storage/storage-takeover.service.ts";
export {
  importStorages,
  PROJCACHE_UNIT_VERSIONS,
  WORKSPACE_UNIT_VERSIONS,
} from "./storage/import-storages.ts";

// 包根的 default 是 dsh 行插件：client-modules 只把**包根**行认作 client row，子路径行不算。
