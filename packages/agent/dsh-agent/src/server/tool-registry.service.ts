// ToolRegistry（工具注册表，绑定契约）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { ToolRegistry } from "../contract/tool-registry.contract.ts";

@Injectable()
export class ToolRegistryDefault extends fromCordis(ToolRegistry, ToolRuntime) {
  systemPrompt = inject(SystemPromptContract);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { systemPrompt: this.systemPrompt });
  }
}
