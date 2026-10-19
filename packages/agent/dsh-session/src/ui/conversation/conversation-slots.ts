// 上游会话主视图（client 行）：消息流、输入框、草案、会话头与右侧面板的座位。
//
// 它的 inject 是 7 个名字：`slots` / `sessions` / `fileUpload` / `uiSession` / `uiWorkspace` /
// `locale` / `configForms`。其中 `uiSession`、`uiWorkspace` 是另外两行内部的服务（走令牌发布），
// `fileUpload` 目前只用于通过依赖校验（附件上传仍在本仓的 `FileUploadStoreDefault` 里，客户端运行时另排期）。
import * as UiConversationPlugin from "@deepseek-ai/dsh-client-ui-conversation/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, Locale, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "../session-controller.contract.ts";
import { UiSession } from "../ui-session.token.ts";
import { Conversation } from "./conversation.token.ts";
import { UiConversation } from "./conversation.token.ts";
import { FileUpload } from "./conversation.token.ts";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";

@Injectable()
export class ConversationSlots extends fromCordis(
  // **这次的多契约是必需的**（与 `sidebarRightTabs` 那次不同）：
  // `ConversationController` 由上游 apply 内部的 `ctx.plugin(ConversationController, …)` 建
  // （`ui-conversation/src/client/apply.ts:590`），它是**子作用域里的 `Service`**（`super(ctx, 'conversation')`），
  // 子插件的启动是异步的，`fromCordis` 的 mount 在末尾扫 `published` 时它还没写进去；
  // 服务本身也不落根名字视图（隔离规则）。所以令牌没法按名绑到根，只能由这一次 mount 一并发布。
  [UiConversation, Conversation],
  UiConversationPlugin,
) {
  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly uiSession = inject(UiSession);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly locale = inject(Locale);

  private readonly configForms = inject(ConfigForms);

  private readonly fileUpload = inject(FileUpload);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      sessions: this.sessions,
      fileUpload: this.fileUpload,
      uiSession: this.uiSession,
      uiWorkspace: this.uiWorkspace,
      locale: this.locale,
      configForms: this.configForms,
    });
  }
}
