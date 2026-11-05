import { Injectable, provide } from "@morlay/zephyr";
import { McpResources } from "@morlay/dsh-agent";
import { RepeatToolReminder } from "../repeat-tool-reminder.service.ts";
import { TimeoutPolicy } from "../timeout-policy.service.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent";

// 工具**调用生命周期**上的四条行：重复提醒、调用超时、图片外置、MCP 资源。
// 它们都不是工具本身（工具定义在上游插件里），所以没有自己的注册表，也没有自己的契约。
/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class ToolPolicyAgentGroup extends AgentProviderGroup {
  readonly entries = [McpResources];
}

export const provideToolPolicy = provide([
  ToolPolicyAgentGroup,
  { provide: RepeatToolReminder, config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
  TimeoutPolicy,
  McpResources,
]);
