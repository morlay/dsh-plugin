// agent 域的事件：名字 + 参数表 + 返回类型收在类里。
//
// 与上游同名即可互通：上游用 `ctx.emit("tools/execute", …)` / `ctx.waterfall("agent/request", …)`
// 派发，我们在这里用同一套名字订阅。订阅方 `inject` 事件令牌、调 `on` / `onWaterfall`——不写字符串。
import type { ToolDispatchExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { EventEmitter } from "@morlay/zephyr";
import type { Agent } from "./agent-directory.contract.ts";
import type { LlmCallConfig } from "./llm-vocabulary.contract.ts";

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

/**
 * 一次模型请求的配置（上游 `agent/request`，`@mode waterfall`）。
 *
 * 四个字段与上游 payload 一一对应：是谁、哪一轮哪一步、这次的取消信号。
 */
export interface AgentRequestPayload {
  readonly agent: Agent;
  readonly turn: number;
  readonly step: number;
  readonly signal: AbortSignal;
}

/**
 * 模型请求组装完配置、发出之前（瀑布）：监听者拿到 `next()`，返回**最终**的调用配置。
 *
 * 这是"按 agent 改路由"的官方挂点（默认模型兜底、账号路由、reasoning 强度都在这里改）。
 */
export class AgentRequest extends EventEmitter<[AgentRequestPayload], Promise<LlmCallConfig>> {
  constructor() {
    super("agent/request");
  }
}

/**
 * 工具注册表变了（上游 `tools/change`，零参 `emit`）。
 *
 * 派发作用域决定看得见多少：根上的那份报全局注册表的变化，某个 agent 的 `agentCtx` 上那份
 * 只报**这个 agent** 的工具面变化——所以「按 agent 维护工具投影」的订阅要装在 agent scope 里。
 */
export class ToolChange extends EventEmitter {
  constructor() {
    super("tools/change");
  }
}
