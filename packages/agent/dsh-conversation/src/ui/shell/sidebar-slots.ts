// 上游侧栏骨架（client 行）：品牌、新建会话、panellist、设置与折叠全部由 `ui-sidebar` 渲染。
//
// 骨架是 `sidebar` 那个 single 位置的声明方——`sidebar.workspaces` 里的上游 `WorkspaceBrowser`、
// `sidebar.settings`、`sidebar.footer.action` 这些条目都挂在它下面。
import * as UiSidebarPlugin from "@deepseek-ai/dsh-client-ui-sidebar/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Layout, Locale, Shortcuts, Slots } from "@morlay/zephyr-app/client";
import { UiWorkspace } from "@morlay/dsh-conversation/contract";

@Injectable()
export class SidebarSlots extends fromCordis(UiSidebarPlugin) {
  private readonly slots = inject(Slots);

  private readonly layout = inject(Layout);

  /** 「新建会话」按钮走 `uiWorkspace.startSession()`（它会先选当前/最近的 workspace）。 */
  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly locale = inject(Locale);

  private readonly shortcuts = inject(Shortcuts);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      layout: this.layout,
      uiWorkspace: this.uiWorkspace,
      locale: this.locale,
      shortcuts: this.shortcuts,
    });
  }
}
