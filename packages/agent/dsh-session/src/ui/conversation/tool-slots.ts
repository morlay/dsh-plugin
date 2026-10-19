// 上游工具卡片渲染（client 行）：`ui-tool` 把内置工具的展示注册进会话节点。
//
// inject 只有 `slots` / `remote`：工具行按 `conversation.tool` 一类 keyed 位置注册，
// 那些位置由 `ui-conversation` 声明（`slots.inject` 会等声明出现）。
import * as UiToolPlugin from "@deepseek-ai/dsh-client-ui-tool/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote, Slots } from "@morlay/zephyr-app/client";
import { UiConversation } from "./conversation.token.ts";

@Injectable()
export class ToolSlots extends fromCordis(UiToolPlugin) {
  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  // 工具卡片（它的子插件）要读 `ctx.uiConversation`：按我们的模式必须是**本行显式注入**的依赖。
  private readonly uiConversation = inject(UiConversation);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      remote: this.remote,
      uiConversation: this.uiConversation,
    });
  }
}
