// CLI 自己的 logger：输出只走级别，不额外造一套「进度条」语义。
//
// `bootstrapApplication` 会把 cordis 的 logger 装到契约上；CLI 覆盖它，是为了让 `--log-level`
// 真的能关掉噪音（cordis 的默认级别不归我们管）。
import { Logger } from "@morlay/zephyr";

/** 级别（低 → 高）。 */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

/** 级别取值。 */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 每个级别是否输出。 */
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

/**
 * 是不是合法级别。
 * @param value - 待判断。
 * @returns 判断结果。
 */
export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** 一个按级别过滤、写到两个流的 logger。 */
export class CliLogger extends Logger {
  /** 低于它的不输出。 */
  private readonly rank: number;

  /**
   * @param level - 阈值级别。
   * @param streams - 两个流（`info/debug` 走 stdout，`warn/error` 走 stderr）。
   */
  constructor(
    level: LogLevel = "info",
    private readonly streams: {
      readonly stdout: (line: string) => void;
      readonly stderr: (line: string) => void;
    } = {
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    },
  ) {
    super();
    this.rank = RANK[level];
  }

  /** @param format - 文本（cordis 用 format + 参数）。 @param params - 插值参数。 */
  error(format: unknown, ...params: unknown[]): void {
    this.emit(3, this.streams.stderr, format, params);
  }

  /** @param format - 文本。 @param params - 插值参数。 */
  warn(format: unknown, ...params: unknown[]): void {
    this.emit(2, this.streams.stderr, format, params);
  }

  /** @param format - 文本。 @param params - 插值参数。 */
  info(format: unknown, ...params: unknown[]): void {
    this.emit(1, this.streams.stdout, format, params);
  }

  /** @param format - 文本。 @param params - 插值参数。 */
  debug(format: unknown, ...params: unknown[]): void {
    this.emit(0, this.streams.stdout, format, params);
  }

  /**
   * 过滤后输出。
   * @param rank - 该条目的级别序。
   * @param sink - 写到哪。
   * @param format - 文本。
   * @param params - 插值参数。
   */
  private emit(
    rank: number,
    sink: (line: string) => void,
    format: unknown,
    params: readonly unknown[],
  ): void {
    if (rank < this.rank) return;
    sink(formatText(format, params));
  }
}

/**
 * 按 cordis 的 `format + 参数` 约定拼文本（`%s` / `%d` 占位；没有占位符就追加）。
 * @param format - 格式串或任意值。
 * @param params - 插值参数。
 * @returns 一行文本。
 */
function formatText(format: unknown, params: readonly unknown[]): string {
  if (typeof format !== "string") return [format, ...params].map(String).join(" ");
  let index = 0;
  const text = format.replace(/%[sdifjoO]/gu, () => paramText(params[index++]));
  return index === 0 && params.length > 0
    ? [text, ...params.map((value) => paramText(value))].join(" ")
    : text;
}

/**
 * 一个插值参数的文本形态（对象走 JSON，其余走字面量）。
 * @param value - 任意值。
 * @returns 文本。
 */
function paramText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "symbol") return value.description ?? "";
  if (typeof value === "function")
    return value.name === "" ? "[function]" : `[function ${value.name}]`;
  return JSON.stringify(value) ?? "";
}
