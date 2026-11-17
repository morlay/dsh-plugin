// 本包订阅的上游事件：名字、参数表、返回类型都收在类里（拼错名字或参数表在编译期就报）。
// 与上游同名即可互通——上游用 `ctx.emit("agent/created", …)` 派发，我们在这里用同一套名字订阅。
//
// 声明成 Provider 的**字段**（`readonly assemble$ = new SystemPromptAssemble()`）：框架在填充注入后对每个
// `EventEmitter` 字段调 `onInit(ctx)`，不需要额外的接线。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { LlmFailure, MessageSource, ModelSelection } from "@morlay/dsh-agent/contract";
import type { ResolvedRetryPolicy } from "@morlay/dsh-agent/contract";
import type { UserMessage } from "@morlay/dsh-agent/contract";
import type {
  AssembleContext,
  AssembledContext,
  AssembledSection,
} from "@morlay/dsh-agent/contract";
import { EventEmitter } from "@morlay/zephyr";

// 一次装配的呈现面（`system-prompt/assemble` 的入参 / 出参）。
export interface PromptPresentation {
  readonly sections: AssembledSection[];
  readonly contexts: AssembledContext[];
  readonly variables: Record<string, string | undefined>;
}

// 一步的前置决定：`enter` 进这一步，`reject` 拒绝。
export type PreStepDecision =
  | { readonly kind: "enter"; readonly messages: UserMessage[] }
  | { readonly kind: "reject"; readonly reason?: string };

// 一次失败的模型请求：`retry` 表示接管重试。
export type RequestErrorAction = { readonly kind: "retry" } | undefined;

// 会话建好了（晚于它的 preset 行挂载，早于第一次装配）。
export class AgentCreated extends EventEmitter<[{ readonly agent: Agent }]> {
  constructor() {
    super("agent/created");
  }
}

// 工具注册表变了（全局或某个会话的作用域）：汉化要跟着改新注册的那些定义。
export class ToolsChanged extends EventEmitter {
  constructor() {
    super("tools/change");
  }
}

// 一步装配系统提示词（瀑布）：监听者拿到 `next`。
export class SystemPromptAssemble extends EventEmitter<
  [PromptPresentation, AssembleContext],
  Promise<PromptPresentation>
> {
  constructor() {
    super("system-prompt/assemble");
  }
}

// 一步开始前的消息表（瀑布）：官方那几行的每步注入都在这里。
//
// 六个字段与上游 `Events['agent/pre-step']` 的 payload 一一对应（少一个，消费方就只能在类型外绕道）。
export interface PreStepPayload {
  readonly agent: Agent;
  readonly messages: UserMessage[];
  readonly turn: number;
  readonly step: number;
  readonly signal: AbortSignal;
  /** 这一步捕获的模型选择：重试沿用同一个值，省略推理强度时走适配器默认。 */
  readonly modelSelection: Readonly<ModelSelection>;
}

export class AgentPreStep extends EventEmitter<[PreStepPayload], Promise<PreStepDecision>> {
  constructor() {
    super("agent/pre-step");
  }
}

// 一次模型请求失败（瀑布）：返回 `retry` 表示接管重试。
//
// 七个字段与上游 `Events['agent/request-error']` 的 payload 一一对应：失败本身（`provider` / `failure`）、
// 它发生在哪一步（`turn` / `step`）、以及当时生效的重试策略——判定"这一次该不该接管"要用到它们。
export interface RequestErrorPayload {
  readonly agent: Agent;
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly failure: LlmFailure;
  readonly retryPolicy: ResolvedRetryPolicy | undefined;
  readonly signal: AbortSignal;
}

export class AgentRequestError extends EventEmitter<
  [RequestErrorPayload],
  Promise<RequestErrorAction>
> {
  constructor() {
    super("agent/request-error");
  }
}

// 一条消息来源的 kind（`skill-catalog` 这些由各自的行声明，按字符串读）。
export function sourceKindOf(source: MessageSource): string | undefined {
  const kind = (source as { readonly kind?: unknown } | undefined)?.kind;
  return typeof kind === "string" ? kind : undefined;
}
