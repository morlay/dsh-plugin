// 管理面子出口（`@morlay/session-rdb/admin`）：能力 + 端点常量与纯函数；HTTP 层在消费它的前端包里。
export {
  SessionAdmin,
  type SessionAdminGcResult,
  type SessionAdminRows,
} from "./session-admin.service.ts";
export type {
  SessionRowsItem,
  SessionRowsRequest,
  SessionRowsValue,
} from "../query/session-rows.types.ts";
export type { UsageAggregate, UsageRangeKey } from "../usage/usage.ts";
export { parseUsageRange, resolveUsageSince } from "../usage/usage.ts";
export { MAX_IMPORT_ZIP_BYTES, parseImportZip } from "../import/session-import.ts";
export { SessionDeletionError, type SessionDeletionErrorCode } from "../persistence/session-persistence-rdb.service.ts";
export {
  SESSION_DELETE_PATH,
  SESSION_EXPORT_PATH,
  SESSION_GC_PATH,
  SESSION_IMPORT_PATH,
  SESSION_ROWS_PATH,
  SESSION_USAGE_PATH,
} from "../routes.ts";
