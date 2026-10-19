// ToolWeb（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolWebPlugin from "@deepseek-ai/dsh-tool-web";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Tools } from "@morlay/dsh-agent";
import { Web } from "@morlay/dsh-tool-web";

@Injectable()
export class ToolWeb extends fromCordis(ToolWebPlugin) {
  tools = inject(Tools);

  web = inject(Web);

  systemPrompt = inject(SystemPromptContract);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      web: this.web,
      systemPrompt: this.systemPrompt,
    });
  }
}
