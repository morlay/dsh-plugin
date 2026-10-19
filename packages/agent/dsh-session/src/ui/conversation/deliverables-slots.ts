// 交付物卡片 + 右侧「交付物」标签类型（上游 `ui-deliverables`）。
//
// 它要 `sidebarRightTabs`（标签类型注册表）与 `sidebarRight`（面板动作面）：
// 前者由应用侧的侧栏行提供独立实例，后者由 `ui-sidebar-right` 提供。
// 标签类型注册到独立实例上，因此**不会出现在右侧面板的标签条里**（面板读的是它自己那一份），
// 交付物卡片本身照常渲染。
import * as UiDeliverablesPlugin from "@deepseek-ai/dsh-client-ui-deliverables/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { UiConversation } from "./conversation.token.ts";
import { SidebarRight } from "../ports.ts";
import { SidebarRightTabs } from "../ports.ts";

@Injectable()
export class DeliverablesSlots extends fromCordis(UiDeliverablesPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly uiConversation = inject(UiConversation);

  private readonly remote = inject(Remote);

  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly configForms = inject(ConfigForms);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      uiConversation: this.uiConversation,
      remote: this.remote,
      "remote.session": this.remote,
      sidebarRightTabs: this.sidebarRightTabs,
      sidebarRight: this.sidebarRight,
      configForms: this.configForms,
    });
  }
}
