import { Injectable, provide } from "@morlay/zephyr";
import { PtcRuntimeDefault } from "./ptc-runtime.service.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent-contract";

/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class PtcAgentGroup extends AgentProviderGroup {
  readonly entries = [PtcRuntimeDefault];
}

export const providePtc = provide([PtcAgentGroup, PtcRuntimeDefault]);
