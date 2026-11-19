// 选中消息文本 →「引用文本」浮层（上游 `message-quotes` 的浏览器半）。
//
// 它往两个槽位注册：`conversation.chat.text-interaction`（选中模型回答文本时那个浮层）与
// `conversation.user.text.node`（用户消息里已引用的片段），另加一条选中交互 + 一条 UserText 规则
// （发出去的消息把引用带成 Markdown 引用块）。
//
// inject 四件（上游逐个真读）：`slots` / `locale` / `sessions` / `uiConversation`。
// 少给任何一个都不会报错而是静默不渲染——所以四件都要在 deps 里点名。
import * as MessageQuotesPlugin from "@deepseek-ai/dsh-message-quotes/client";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";
import { UiConversation } from "./conversation.token.ts";

@Injectable()
export class MessageQuotesSlot extends fromCordis(MessageQuotesPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly sessions = inject(SessionController);

  private readonly uiConversation = inject(UiConversation);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      sessions: this.sessions,
      uiConversation: this.uiConversation,
    });
  }
}
