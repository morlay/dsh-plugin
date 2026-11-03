/**
 * 会话删除的失败语义（叶子模块）。
 *
 * 放成叶子是为了断开 `index ↔ deletion` 的运行时环：HTTP 路由只依赖这个错误类型，不再值引入整个服务。
 */
export type SessionDeletionErrorCode = "SESSION_NOT_FOUND" | "SESSION_NOT_ARCHIVED" | "SESSION_LIVE";

export class SessionDeletionError extends Error {
  constructor(
    message: string,
    readonly code: SessionDeletionErrorCode,
  ) {
    super(message);
    this.name = "SessionDeletionError";
  }
}
