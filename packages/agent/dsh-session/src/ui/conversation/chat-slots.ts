// 上游会话消息渲染（client 行）：`ui-chat` 注册消息、步骤、工具调用等节点的渲染器。
//
// inject 是 10 个名字：`slots` / `sessions` / `uiWorkspace` / `uiSession` / `uiConversation` / `locale` /
// `configForms` / `remote` / `remote.session` / `sidebarRight`。其中三个是本仓发布的服务令牌
// （`uiWorkspace`、`uiSession`、`uiConversation`、`sidebarRight`），带点的 `remote.session` 按字面键给。
import * as UiChatPlugin from "@deepseek-ai/dsh-client-ui-chat/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import {
  ConfigForms,
  Connection,
  FileDragDefault,
  Locale,
  Remote,
  Slots,
} from "@morlay/zephyr-app/client";
import { SessionController } from "../session-controller.contract.ts";
import { UiConversation } from "./conversation.token.ts";
import { SidebarRight } from "../ports.ts";
import { UiSession } from "../ui-session.token.ts";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";

@Injectable()
export class ChatSlots extends fromCordis(UiChatPlugin) {
  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly uiSession = inject(UiSession);

  private readonly uiConversation = inject(UiConversation);

  private readonly locale = inject(Locale);

  private readonly configForms = inject(ConfigForms);

  private readonly remote = inject(Remote);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly connection = inject(Connection);

  private readonly fileDrag = inject(FileDragDefault);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      sessions: this.sessions,
      uiWorkspace: this.uiWorkspace,
      uiSession: this.uiSession,
      uiConversation: this.uiConversation,
      locale: this.locale,
      configForms: this.configForms,
      remote: this.remote,
      // 带点的名字按**字面键**给出（`fromCordis` 的 deps 校验逐字匹配）。
      "remote.session": this.remote,
      sidebarRight: this.sidebarRight,
      connection: this.connection,
      // 字面键：上游按 `ctx.fileDrag` 读它。
      fileDrag: this.fileDrag,
    });
  }
}
