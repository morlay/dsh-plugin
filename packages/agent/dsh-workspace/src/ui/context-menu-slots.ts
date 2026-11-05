// 上下文菜单的行：上游 `ui-context-menu`（对外面 `ctx.contextMenus`）。
//
// 侧栏的工作区/会话行现在用**结构化菜单**（`ctx.contextMenus.register`），`ui-workspace` 的 client 行
// 在 `inject` 里点名要它——少这一行，那条 inject 不激活、`ui-workspace` 整个不跑，
// 侧栏就只剩壳（界面上表现为 `cannot get property "contextMenus" without inject`）。
import * as UiContextMenuPlugin from "@deepseek-ai/dsh-client-ui-context-menu/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ContextMenus, Locale, Shortcuts, Slots } from "@morlay/zephyr-app/client";

// 适配行的令牌是**契约**（`extends fromCordis(...)` 的产物不是契约的子类，派生名会变成 `context-menu-slots`）。
@Injectable({ token: ContextMenus })
export class ContextMenuSlots extends fromCordis(ContextMenus, UiContextMenuPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly shortcuts = inject(Shortcuts);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 `inject = ['slots', 'locale', 'shortcuts']`。
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      shortcuts: this.shortcuts,
    });

  }
}
