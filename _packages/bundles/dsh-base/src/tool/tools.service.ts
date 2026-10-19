// Tools（工具注册表，绑定契约）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolsDefault extends fromCordis(Tools, ToolRuntime) {
  systemPrompt = inject(SystemPrompt);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { systemPrompt: this.systemPrompt });
  }
}
