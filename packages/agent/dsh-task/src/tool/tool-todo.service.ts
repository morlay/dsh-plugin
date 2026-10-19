// ToolTodo（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolTodoPlugin from "@deepseek-ai/dsh-tool-todo";
import { SessionProjections } from "@morlay/dsh-session";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class ToolTodo extends fromCordis(ToolTodoPlugin) {
  tools = inject(Tools);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      sessionProjections: this.sessionProjections,
    });
  }
}
