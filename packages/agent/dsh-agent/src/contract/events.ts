// agent 域的事件：名字 + 参数表 + 返回类型收在类里。
//
// 与上游同名即可互通：上游用 `ctx.emit("tools/execute", …)` / `ctx.waterfall("tools/execute", …)`
// 派发，我们在这里用同一套名字订阅。
import type { ToolDispatchExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { EventEmitter } from "@morlay/zephyr";

/**
 * 工具执行前的水瀑（上游 `tools/execute`，`@mode waterfall`）。
 *
 * 参数表是 `[ToolDispatchExecution]`；监听者拿到 `next()`，调它表示"照原样继续"，
 * 返回的就是这次执行的最终结果。
 */
export class ToolExecute extends EventEmitter<
  [ToolDispatchExecution],
  Promise<ToolExecutionResult>
> {
  constructor() {
    super("tools/execute");
  }
}
