// 命令行的两种失败：**用法错误**（argv 写错了，退出码 2）与**执行失败**（跑起来以后失败，退出码 1）。
//
// 分开的理由是调用方（justfile / CI）能据此区分「我写错了」与「它坏了」；把它们并成一个码，
// 脚本里就只能靠看日志猜。

/** 命令行错误：带退出码。 */
export class CliError extends Error {
  /** 建议的进程退出码。 */
  readonly code: number;

  /**
   * @param message - 给人看的说明（中文，含下一步该改什么）。
   * @param code - 退出码（用法错误 2，执行失败 1）。
   */
  constructor(message: string, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/**
 * 用法错误：argv 不合规（未知 flag、缺值、枚举越界、父命令缺失）。
 * @param message - 说明。
 * @returns 待抛出的错误。
 */
export function usageError(message: string): CliError {
  return new CliError(message, 2);
}
