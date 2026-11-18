import { provide } from "@morlay/zephyr";
import { McpResources } from "@morlay/dsh-agent";
import { RepeatToolReminder } from "../repeat-tool-reminder.service.ts";
import { TimeoutPolicy } from "../timeout-policy.service.ts";

// 工具**调用生命周期**上的三条行：重复提醒、调用超时、MCP 资源。
//
// 它们都不是工具本身（工具定义在上游插件里），所以没有自己的注册表，也没有自己的契约。
//
// 装配位置**这一票不动**（都还在应用根）：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent
// 分开。按 scope 装配（`@AgentScoped()`）要连着它们的消费方一起量，见
// `packages/agent/.agents/designs/20261118-per-agent-插件的装配位置.md` 的「迁移面」。
export const provideToolPolicy = provide([
  { provide: RepeatToolReminder, config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
  TimeoutPolicy,
  McpResources,
]);
