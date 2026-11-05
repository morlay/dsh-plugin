// 输入框旁的模型选择器（上游 `ui-model-selection` 的 **client 半**）。
//
// 上游那一行是**一个插件的两个入口**：`/model` 弹层（往 `commandUi` 注册）与输入区的
// `conversation.input.model` 座位，两者共用它自己建的 `ctx.modelDirectories`（每会话一份目录，
// 数据来自 `session/modelCatalog`，写入走 `session/selectModel`）。本行不重写任何界面：
// 只把它的六项外部服务按上游注册名接上（`sessions` / `slots` / `locale` / `remote` /
// `remote.session` / `commandUi`）。
//
// `commandUi` 用真的契约（`@morlay/dsh-command` 的 `CommandUi`，实现是上游 `ui-commands` 那一行）：
// 空面会让 `/model` 的贡献被吞掉——`/` 面板里就没有它，而且不报错。
import * as UiModelSelectionPlugin from "@deepseek-ai/dsh-client-ui-model-selection/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { CommandUi } from "@morlay/dsh-command/ui";
import { SessionController } from "@morlay/dsh-session/ui";

@Injectable()
export class ModelSelectionSlots extends fromCordis(UiModelSelectionPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly commandUi = inject(CommandUi);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      "remote.session": this.remote,
      commandUi: this.commandUi,
    });
  }
}
