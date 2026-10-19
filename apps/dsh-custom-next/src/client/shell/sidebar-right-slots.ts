// 上游右侧面板（client 行）：`ui-sidebar-right` 占 `rightbar`，提供标签页、展开按钮与引导页。
//
// 它的 inject 是 7 个名字：`slots` / `layout` / `locale` / `resources` / `sessions` / `uiSession` / `shortcuts`。
// 其中 `uiSession` 是 `ui-session` 行内部的服务（走 `ui-session.token.ts` 令牌发布），
// 另外几个都是我们的契约面。
import * as UiSidebarRightPlugin from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Layout, Locale, Resources, Shortcuts, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { UiSession } from "@morlay/dsh-session/ui";
import { SidebarRight } from "@morlay/dsh-session/ui";

@Injectable()
// 单契约：`sidebarRight`。上游 apply 顺手 `provide` 的 `sidebarRightTabs` 由 mount 按它自己的
// 注册名发布到根名字视图（`publishServiceName` 会把同名令牌 `SidebarRightTabs` 一并指向同一份实例）。
export class SidebarRightSlots extends fromCordis(SidebarRight, UiSidebarRightPlugin) {
  private readonly slots = inject(Slots);

  private readonly layout = inject(Layout);

  private readonly locale = inject(Locale);

  private readonly resources = inject(Resources);

  private readonly sessions = inject(SessionController);

  private readonly uiSession = inject(UiSession);

  private readonly shortcuts = inject(Shortcuts);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      layout: this.layout,
      locale: this.locale,
      resources: this.resources,
      sessions: this.sessions,
      uiSession: this.uiSession,
      shortcuts: this.shortcuts,
    });
  }
}
