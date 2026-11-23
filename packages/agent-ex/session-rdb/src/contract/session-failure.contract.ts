// 会话域的**稳定失败码**：wire 上的 `error.code` 就是它，端点不翻译、客户端按码分派。
//
// 为什么在最底层：`data/errors.ts`（抛出方）与浏览器半的文案映射（消费方）都要它，
// 而浏览器半只许从 `./endpoint` 取——所以形状在这里，`contract/index.ts` 聚合端口时不带它，
// 由 `./endpoint` 转出一份（那里是「两端共用的值/类型」面）。
//
// 按能力分组：读（QUERY_*）、导入（IMPORT_*）、编辑（EDITOR_*）、落盘（CONCURRENT_WRITER / EVENT_REJECTED）、
// 管理面（NOT_FOUND / LIVE / NOT_ARCHIVED / 整理 / 修法 / 列表与用量的入参 / 跨工作区复制）、
// 库层（STORAGE_INCOMPATIBLE）。
export type SessionStoreFailure =
  // 读面：目标不存在 / 查询参数不合法 / 搜索没开。
  | "SESSION_NOT_FOUND"
  | "SESSION_QUERY_SESSION_NOT_FOUND"
  | "SESSION_QUERY_EVENT_NOT_FOUND"
  | "SESSION_QUERY_INVALID_WINDOW"
  | "SESSION_QUERY_READ_WINDOW_MAX"
  | "SESSION_QUERY_SEARCH_DISABLED"
  // 写面：位点冲突（跨实例有别的写者）/ 事件体被上游校验拒绝。
  | "SESSION_CONCURRENT_WRITER"
  | "SESSION_EVENT_REJECTED"
  // 导入：目标有写句柄 / 包太大 / 形状不对 / 不是会话导出包（解不开的 zip）。
  //
  // `SESSION_IMPORT_INVALID_PACKAGE` 是「**所选文件不是会话导出包**」（zip 解不开），不是「目标未归档」：
  // 覆盖导入的归档前置只在页面侧（`aria-disabled`），宿主只判写句柄。码名与用途要对得上，
  // 别按「NOT_ARCHIVE = 目标未归档」去读它。
  | "SESSION_IMPORT_LIVE"
  | "SESSION_IMPORT_TOO_LARGE"
  | "SESSION_IMPORT_NO_ARTIFACT"
  | "SESSION_IMPORT_MALFORMED_LOG"
  | "SESSION_IMPORT_INCOMPLETE"
  | "SESSION_IMPORT_INVALID_PACKAGE"
  // 管理面：删除的三条拒绝理由、整理、修法、列表与用量的入参。
  | "SESSION_LIVE"
  | "SESSION_NOT_ARCHIVED"
  | "SESSION_ORGANIZE_LIVE"
  | "SESSION_FLUSH_FAILED"
  | "SESSION_REPAIR_INVALID_ACTION"
  | "SESSION_ROWS_INVALID_PAGE"
  | "SESSION_USAGE_INVALID_RANGE"
  // 跨工作区复制：目标工作区不在注册表 / workspace 域拒绝了 attach。
  | "SESSION_COPY_WORKSPACE_NOT_FOUND"
  | "SESSION_COPY_ATTACH_FAILED"
  // 库层：版本或身份对不上（这份库不是本构建认识的会话库）。
  | "SESSION_STORAGE_INCOMPATIBLE"
  // 编辑面：重放面不可用。
  | "SESSION_EDITOR_REPLAY_UNAVAILABLE";
