// 输入框旁的模型选择器（上游 `ui-model-selection` 的 **client 半**）。
//
// 上游那一行是**一个插件的两个入口**：`/model` 弹层（往 `commandUi` 注册）与输入区的
// `conversation.input.model` 座位，两者共用它自己建的 `ctx.modelDirectories`（每会话一份目录，
// 数据来自 `session/modelCatalog`，写入走 `session/selectModel`）。本行不重写任何界面：
// 只把它的六项外部服务按上游注册名接上（`sessions` / `slots` / `locale` / `remote` /
// `remote.session` / `commandUi`）。
//
// **`commandUi` 用显式空面**：本仓的命令弹层是自研的（`CommandPaletteStore` + `RemoteCommandCatalog`），
// 没有装上游 `ui-commands` 那一行；再装一套会让两套弹层并存。`/model` 的弹层装饰因此降级成空操作，
// 输入区的座位不受影响。形状照 `packages/agent/dsh-permission/src/ui/ui-permission.service.ts` 的
// `COMMAND_UI_SHIM`——同一个事实只写一份形状，不写第二种（塞 `undefined` 会让上游分支抛未处理 TypeError）。
import * as UiModelSelectionPlugin from "@deepseek-ai/dsh-client-ui-model-selection/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
/**
 * `commandUi` 的空面：上游这一行用 `register` 把 `/model` 挂成输入区的 `popupSelect` 贡献。
 * 本装配降级成空操作——贡献收下、不渲染、返回撤销函数（与 `ui-permission.service.ts` 的
 * `COMMAND_UI_SHIM` 同一手法；那一行的上游面是 `decorate` / `dismiss`，成员名随各行的上游面走）。
 */
const COMMAND_UI_SHIM = {
  register: (_contribution: unknown): (() => void) => () => {},
};

@Injectable()
export class ModelSelectionSlots extends fromCordis(UiModelSelectionPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      "remote.session": this.remote,
      commandUi: COMMAND_UI_SHIM,
    });
  }
}
