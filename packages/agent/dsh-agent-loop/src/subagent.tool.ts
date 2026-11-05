// 子代理工具行（`subagent`）：把上游 `tool-subagent` 要的依赖交给它。
//
// 和 `subagent-fork.tool.ts` 共用同一个上游插件、同一组注入、同一次 `mount`——但**不能**合成一个类
// 再 `withConfig` 两次：装配合并按 `providerBase` 去重，`withConfig` 生成的子类指回被配置的类，
// 同一个类配两次只会活下最后一条。所以两条行各有一个自己的类身份（去重键就是它）。
//
// 判别两条行的是**类身份**、不是名字：两者的服务名都取上游插件名（`tool-subagent`，适配类的既有口径）。
import * as ToolSubagentPlugin from "@deepseek-ai/dsh-tool-subagent";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SubagentRegistry } from "@morlay/dsh-agent/contract";

@Injectable()
export class ToolSubagent extends fromCordis(ToolSubagentPlugin) {
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
