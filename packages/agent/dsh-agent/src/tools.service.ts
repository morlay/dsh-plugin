// Tools（工具注册表，绑定契约）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolsDefault extends fromCordis(Tools, ToolRuntime) {
  systemPrompt = inject(SystemPromptContract);

  protected override async onInit(ctx: Context): Promise<void> {
    // `systemPrompt` 是**依赖**（上游构造里 `ctx.systemPrompt.tools(...)`），走 `mount` 的第三参数；
    // 塞进第二参数会被当成上游 config，`ctx.systemPrompt` 就还是 undefined。
    await this.mount(ctx, undefined, { systemPrompt: this.systemPrompt });
  }
}
