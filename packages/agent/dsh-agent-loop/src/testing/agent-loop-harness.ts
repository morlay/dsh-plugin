// 「跑一轮」的测试装配：**本仓实现**（不借上游 testkit）。
//
// 只导出 `loopTestProviders()`（纯清单函数）：装配统一走 `bootstrapApplication`——本仓的正规测试入口。
// 原来还导出 `mountLoopTestDependencies()` / `mountLoopTestHarness()`（「挂到调用方 ctx 上」的第二套内核），
// 全仓零调用且与 `bootstrapApplication` 重复，已随 `mount.ts` 一起删。
import { configure, provide, type ProviderList } from "@morlay/zephyr";
import { SystemPromptDefault, provideAgent } from "@morlay/dsh-agent";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { AgentLoopDefault, ToolExecutorNative } from "../index.ts";

/** 上游 `Agent` 的类型面（vendor 的模块增强，本仓 program 看不到整份形状）。 */
export type Agent = import("@morlay/dsh-agent/contract").Agent;

/** 循环本体那一份（默认 `agents: []`）。 */
const loopRow = provide([AgentLoopDefault], [configure(AgentLoopDefault, { agents: [] })]);

/** 装配选项（与上游 testkit 的三个选项同义）。 */
export interface LoopTestOptions {
  /** 装上工作目录（要读目录的用例才需要）。 */
  readonly workingDirectory?: boolean;
  /** 提示词配置（透传给 `SystemPromptDefault`，形状由上游 `Config` 决定）。 */
  readonly systemPrompt?: Record<string, unknown>;
  /** 工具面：`native` 或 `ptc`（默认 native）。 */
  readonly tools?: { readonly mode?: "native" | "ptc" };
}

/**
 * 跑一轮对话所需的装配清单（本仓的装配方式）。
 *
 * 装「骨架（含提示词与默认模型）+ 会话 + 投影 + 执行器」；`headless` 时到此为止，不装循环本体。
 * @param options - 见 `LoopTestOptions` 与 `headless`。
 * @returns 条目清单。
 */
export function loopTestProviders(
  options: LoopTestOptions & { readonly headless?: boolean } = {},
): ProviderList {
  const systemPrompt = options.systemPrompt;
  const personaLed =
    systemPrompt === undefined
      ? [...provideAgent()]
      : [...provideAgent(configure(SystemPromptDefault, systemPrompt as never))];
  return [
    ...provideSession(),
    ...provideSessionProjection(),
    ...personaLed,
    ToolExecutorNative,
    ...(options.headless === true ? [] : loopRow()),
  ];
}

/** 测试驱动面：建真 agent 并驱动它的收件箱（与上游 harness 同形）。 */
export interface LoopHarness {
  /** 建一个真 agent（与它的会话）。 */
  create(id: unknown, options?: unknown, meta?: unknown): Promise<Agent>;
  /** 这一轮的收件箱：投递一条用户消息并取回要处理的那几条。 */
  claim(agent: Agent, target: unknown, turn: number): readonly unknown[];
}
