import type { DialectName } from "./dialect.ts";

// 数据库错误的可判定类别（调用方据此决定重试 / 上报 / 走业务分支）。
//
// - `retryable`：事务冲突（PG 40001 / 40P01），调用方可以整段重跑；
// - `canceled`：语句被取消或超时中断（PG 57014），不是锁竞争；
// - `timeout`：等锁超时 / 拿不到锁（PG 55P03、SQLite BUSY/LOCKED）；
// - `connection`：连接层面的失败（建立、断开、socket 错误），重试要看重连策略；
// - `closed`：库已关闭（`code` 恒为 `ZEPHYR_RDB_CLOSED`），是用错生命周期，不是 SQL 错误；
// - `unsupported`：方言缺这项能力（`code` 恒为 `ZEPHYR_RDB_UNSUPPORTED`），不静默降级；
// - `identity`：库身份不符（`code` 恒为 `ZEPHYR_RDB_IDENTITY_MISMATCH`），拒绝往别人的库里写。
export type DbErrorKind =
  | "unique"
  | "foreign-key"
  | "not-null"
  | "check"
  | "timeout"
  | "retryable"
  | "canceled"
  | "connection"
  | "closed"
  | "unsupported"
  | "identity"
  | "unknown";

// 本包自己造的两种错误码：能力缺失与已关闭（不是驱动给的，但调用方同样按 `code` 判定）。
export const UNSUPPORTED_CODE = "ZEPHYR_RDB_UNSUPPORTED";
export const CLOSED_CODE = "ZEPHYR_RDB_CLOSED";

// 方言缺能力时的错误：调用方拿 `kind` 分支，或按 `code` 精确判定。
export function unsupportedError(dialect: DialectName, capability: string): DbError {
  return new DbError("unsupported", `zephyr-rdb: ${dialect} does not support '${capability}'`, {
    code: UNSUPPORTED_CODE,
  });
}

// 取消（`AbortSignal`）导致的失败：`code` 用 Node 的惯例值，`cause` 带 signal 的原因。
export function canceledError(reason: unknown): DbError {
  return new DbError("canceled", "zephyr-rdb: query canceled", {
    code: "ABORT_ERR",
    cause: reason,
  });
}

// 统一的数据库错误：`kind` 是方言无关的判定，原始错误在 `cause`；`code` / `sqlState` 是驱动的原始标识。
export class DbError extends Error {
  constructor(
    readonly kind: DbErrorKind,
    message: string,
    options?: { cause?: unknown; code?: string | undefined; sqlState?: string | undefined },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DbError";
    this.code = options?.code;
    this.sqlState = options?.sqlState;
  }

  /** 驱动的原始错误码（PostgreSQL 的 SQLSTATE、SQLite 的 errcode、socket 的 E*）。 */
  readonly code: string | undefined;

  /** PostgreSQL 的 SQLSTATE（与 `code` 同值时只在这里再给一次，调用方按习惯取）。 */
  readonly sqlState: string | undefined;
}

// socket / 连接层错误码：node-postgres 在连接建立与断开时给这些，而不是 SQLSTATE。
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
]);

// PG 的 SQLSTATE → 类别。表只列可判定的；其余进 unknown。
const POSTGRES_STATES: Record<string, DbErrorKind> = {
  "23505": "unique",
  "23503": "foreign-key",
  "23502": "not-null",
  "23514": "check",
  "40001": "retryable",
  "40P01": "retryable",
  "57014": "canceled",
  "55P03": "timeout",
  "53300": "connection",
  "57P01": "connection",
  "57P02": "connection",
  "57P03": "connection",
};

// SQLite 的扩展错误码（node:sqlite 的 errcode）：文本会随版本变，码不会。
const SQLITE_CODES: Record<number, DbErrorKind> = {
  1555: "unique",
  2067: "unique",
  787: "foreign-key",
  1299: "not-null",
  275: "check",
  5: "timeout",
  6: "timeout",
  261: "timeout",
};

function detailOf(error: unknown): { code: string | undefined; message: string } {
  const cause = error as { code?: unknown; errcode?: unknown; message?: unknown } | undefined;
  const code =
    typeof cause?.code === "string"
      ? cause.code
      : typeof cause?.errcode === "number"
        ? String(cause.errcode)
        : undefined;
  const message = typeof cause?.message === "string" ? cause.message : String(error);
  return { code, message };
}

// 把驱动错误翻译成 DbErrorKind：SQLite 先看 errcode 再看文本，PostgreSQL 看 SQLSTATE 与 socket 码。
export function classifyError(error: unknown, dialect: DialectName): DbError {
  if (error instanceof DbError) return error;
  const { code, message } = detailOf(error);

  if (dialect === "postgres") {
    const kind =
      (code === undefined ? undefined : POSTGRES_STATES[code]) ??
      (code === undefined ? undefined : CONNECTION_CODES.has(code) ? "connection" : undefined) ??
      (code !== undefined && code.startsWith("08") ? "connection" : undefined) ??
      (/connection terminated|terminating connection|connection closed/iu.test(message)
        ? "connection"
        : undefined);
    return new DbError(kind ?? "unknown", message, {
      cause: error,
      ...(code === undefined ? {} : { code, sqlState: code }),
    });
  }

  const errcode = code === undefined ? undefined : Number(code);
  const kindByCode =
    errcode === undefined || Number.isNaN(errcode) ? undefined : SQLITE_CODES[errcode];
  if (kindByCode !== undefined) return new DbError(kindByCode, message, { cause: error, code });
  if (/UNIQUE constraint failed/iu.test(message))
    return new DbError("unique", message, {
      cause: error,
      ...(code === undefined ? {} : { code }),
    });
  if (/FOREIGN KEY constraint failed/iu.test(message))
    return new DbError("foreign-key", message, {
      cause: error,
      ...(code === undefined ? {} : { code }),
    });
  if (/NOT NULL constraint failed/iu.test(message))
    return new DbError("not-null", message, {
      cause: error,
      ...(code === undefined ? {} : { code }),
    });
  if (/CHECK constraint failed/iu.test(message))
    return new DbError("check", message, { cause: error, ...(code === undefined ? {} : { code }) });
  if (/SQLITE_BUSY|database is locked|database table is locked/iu.test(message))
    return new DbError("timeout", message, {
      cause: error,
      ...(code === undefined ? {} : { code }),
    });
  return new DbError("unknown", message, { cause: error, ...(code === undefined ? {} : { code }) });
}
