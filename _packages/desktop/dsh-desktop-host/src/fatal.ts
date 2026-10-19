// 出错时给壳的那条事件的形状：`message` 给壳的 dialog 用；`diagnostic` 是完整 `inspect`——stderr
// 字节与这条 IPC 谁先到不确定，所以诊断跟着 IPC 一起走。两处用到（IPC 面与入口的顶层兜底），
// 放这里而不是任何一边。

import { inspect } from "node:util";
import type { DesktopHostEvent } from "./wire.ts";

/** 诊断上限：壳把它写进日志，再长也没有额外价值。 */
const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024;

/** 任何抛出来的东西 → 一行消息。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造一条 `fatal` 事件。
 * @param error - 触发退出的错误（未必是 `Error`）。
 * @returns 带完整诊断的 fatal 事件。
 */
export function fatalEvent(error: unknown): DesktopHostEvent {
  return {
    type: "fatal",
    message: errorMessage(error),
    diagnostic: inspect(error, { depth: 4, maxArrayLength: 50 }).slice(
      0,
      MAX_FATAL_DIAGNOSTIC_CHARS,
    ),
  };
}
