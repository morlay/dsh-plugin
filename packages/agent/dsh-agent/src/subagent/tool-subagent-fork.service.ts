// 子代理 fork 工具（纯实现行，不声明契约）。
import * as ToolSubagentPlugin from "@deepseek-ai/dsh-tool-subagent";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt } from "@morlay/dsh-agent";
import { SessionProjections } from "@morlay/dsh-session";
import { Tools } from "@morlay/dsh-agent";
import { Subagents } from "./subagents.contract.ts";

@Injectable()
export class ToolSubagentFork extends fromCordis(ToolSubagentPlugin) {
  tools = inject(Tools);

  subagents = inject(Subagents);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      subagents: this.subagents,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
