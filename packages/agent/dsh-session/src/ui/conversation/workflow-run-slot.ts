// 会话里的工作流运行卡片（上游 `ui-workflow-run`）。
import * as UiWorkflowRunPlugin from "@deepseek-ai/dsh-client-ui-workflow-run/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "../session-controller.contract.ts";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import { UiConversation } from "./conversation.token.ts";

@Injectable()
export class WorkflowRunSlot extends fromCordis(UiWorkflowRunPlugin) {
  private readonly uiConversation = inject(UiConversation);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly locale = inject(Locale);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      uiConversation: this.uiConversation,
      uiWorkspace: this.uiWorkspace,
      slots: this.slots,
      sessions: this.sessions,
      locale: this.locale,
    });
  }
}
