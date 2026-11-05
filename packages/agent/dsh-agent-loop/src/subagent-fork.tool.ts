// 子代理 `fork` 工具行：与 `subagent.tool.ts` 同一个上游插件、同一组注入。
//
// **不共用基类**：装配合并按 `providerBase` 去重（`fromCordis` 的子类指回被配置的类），
// 共用基类会让两条行活下只剩一条。两条行各自是一个 `@Injectable()` 类，判别靠类身份。
import * as ToolSubagentPlugin from "@deepseek-ai/dsh-tool-subagent";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SubagentRegistry } from "@morlay/dsh-agent/contract";

@Injectable()
export class ToolSubagentFork extends fromCordis(ToolSubagentPlugin) {
  tools = inject(ToolRegistry);

  subagents = inject(SubagentRegistry);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjectionStore);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      subagents: this.subagents,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
