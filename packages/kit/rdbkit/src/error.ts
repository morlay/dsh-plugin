import type { DialectName } from "./dialect.ts";

/** 数据库错误的可判定类别（调用方据此决定重试 / 上报 / 走业务分支）。 */
export type DbErrorKind =
  | "unique"
  | "foreign-key"
  | "not-null"
  | "check"
  | "timeout"
  | "connection"
  | "unknown";

/** 统一的数据库错误：`kind` 是方言无关的判定，原始错误在 `cause`。 */
export class DbError extends Error {
  constructor(
    readonly kind: DbErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DbError";
  }
}

/**
 * 把驱动错误翻译成 {@link DbErrorKind}：SQLite 用错误文本前缀，PostgreSQL 用 SQLSTATE。
 * @param error - 驱动抛出的错误。
 * @param dialect - 产生它的方言。
 * @returns 已分类的错误（原错误在 `cause`）。
 */
export function classifyError(error: unknown, dialect: DialectName): DbError {
  if (error instanceof DbError) return error;
  const cause = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  const message = typeof cause?.message === "string" ? cause.message : String(error);

  if (dialect === "postgres") {
    switch (code) {
      case "23505":
        return new DbError("unique", message, { cause: error });
      case "23503":
        return new DbError("foreign-key", message, { cause: error });
      case "23502":
        return new DbError("not-null", message, { cause: error });
      case "23514":
        return new DbError("check", message, { cause: error });
      case "57014":
      case "55P03":
        return new DbError("timeout", message, { cause: error });
      case "53300":
        return new DbError("connection", message, { cause: error });
      default:
        if (code !== undefined && code.startsWith("08")) {
          return new DbError("connection", message, { cause: error });
        }
        return new DbError("unknown", message, { cause: error });
    }
  }

  if (/UNIQUE constraint failed/iu.test(message))
    return new DbError("unique", message, { cause: error });
  if (/FOREIGN KEY constraint failed/iu.test(message))
    return new DbError("foreign-key", message, { cause: error });
  if (/NOT NULL constraint failed/iu.test(message))
    return new DbError("not-null", message, { cause: error });
  if (/CHECK constraint failed/iu.test(message))
    return new DbError("check", message, { cause: error });
  if (/SQLITE_BUSY|database is locked|database table is locked/iu.test(message)) {
    return new DbError("timeout", message, { cause: error });
  }
  return new DbError("unknown", message, { cause: error });
}
