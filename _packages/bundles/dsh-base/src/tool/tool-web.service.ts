// ToolWeb（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolWebPlugin from "@deepseek-ai/dsh-tool-web";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { Tools } from "./tools.contract.ts";
import { Web } from "@morlay/dsh-base/web";

@Injectable()
export class ToolWeb extends fromCordis(ToolWebPlugin) {
  tools = inject(Tools);

  web = inject(Web);

  systemPrompt = inject(SystemPrompt);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      web: this.web,
      systemPrompt: this.systemPrompt,
    });
  }
}
