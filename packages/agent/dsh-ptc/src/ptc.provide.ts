import { Injectable, provide } from "@morlay/zephyr";
import { PtcRuntimeDefault } from "./ptc-runtime.service.ts";
import { ToolExecutorPtc } from "./tool-executor.service.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent";

/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class PtcAgentGroup extends AgentProviderGroup {
  readonly entries = [PtcRuntimeDefault, ToolExecutorPtc];
}

/**
 * PTC 的两件事：运行时（`ptcRuntime`，跑程序的那台机器）与执行器（把模型面收成 `run_code` 的那一行）。
 *
 * 两者缺一不可：只有运行时，模型面照旧是普通工具清单（执行器才是"选 PTC"这件事的拥有者）；
 * 只有执行器，`run_code` 一跑就抛 "requires a PTC runtime"。
 */
export const providePtc = provide([PtcAgentGroup, PtcRuntimeDefault, ToolExecutorPtc]);
