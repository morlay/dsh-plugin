// 会话域的失败语义：**域码一条通道**，库层原因留在 cause 里。
//
// 为什么域层自己造一层：rdbkit 的 DbError 只回答「库出了哪一类问题」（unique / timeout / retryable …），
// 它不该知道「会话」；调用方（端点、页面、CLI）要的是「哪件事失败了、要不要重试」。端点只转发 code，
// 客户端按码分派、不解析文案；排障时沿 cause 看库层那条（dbErrorOf 把 cause 统一折成 DbError）。
import { classifyError, DbError, type DialectName } from "@morlay/zephyr-rdb";

// 域码的形状在 `contract/session-failure.contract.ts`（最底层）：浏览器半的文案映射也要它，
// 而浏览器半只许从 `./endpoint` 取。这里只转出，抛出方仍用这个类型。
export type { SessionStoreFailure } from "../contract/session-failure.contract.ts";
import type { SessionStoreFailure } from "../contract/session-failure.contract.ts";

// 一次失败的域语义：码是稳定面，message 只给人看，cause 是原因链（库层错误在里面）。
export class SessionStoreError extends Error {
  constructor(
    readonly code: SessionStoreFailure,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SessionStoreError";
  }
}

/**
 * 把捕获到的错误折成库层判定（DbError）：cause 统一成它，排障按 kind 判「能不能重试」。
 *
 * 已经是 DbError 的原样返回（不套第二层）；其它错误保留在它的 cause 里。
 * @param error - 捕获到的错误。
 * @param dialect - 这份库的方言（SQLite / PostgreSQL 的码表不同）。
 * @returns 库层错误。
 */
export function dbErrorOf(error: unknown, dialect: DialectName): DbError {
  return classifyError(error, dialect);
}

/**
 * 造一条域错误：message 保持原文，cause 折成库层判定（没有原文就不带 cause）。
 * @param code - 域码。
 * @param message - 给人看的描述。
 * @param cause - 原因（捕获到的错误 / 其它原因值）。
 * @param dialect - 这份库的方言；省略时不折库层判定（cause 原样挂上）。
 * @returns 域错误。
 */
export function sessionStoreError(
  code: SessionStoreFailure,
  message: string,
  cause?: unknown,
  dialect?: DialectName,
): SessionStoreError {
  if (cause === undefined) return new SessionStoreError(code, message);
  const wired = dialect === undefined ? cause : dbErrorOf(cause, dialect);
  return new SessionStoreError(code, message, { cause: wired });
}

/**
 * 从任意错误里读域码（不是域错误时 undefined）：端点与用例按它分派，不解析文案。
 * @param error - 捕获到的错误。
 * @returns 域码或 undefined。
 */
export function failureCodeOf(error: unknown): SessionStoreFailure | undefined {
  return error instanceof SessionStoreError ? error.code : undefined;
}
