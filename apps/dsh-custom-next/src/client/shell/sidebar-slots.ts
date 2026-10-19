// 上游侧栏骨架（client 行）：品牌、新建会话、panellist、设置与折叠全部由 `ui-sidebar` 渲染。
//
// 为什么不再自己画侧栏：`SessionListView` 那份自写骨架与上游在同一个 `sidebar` 位置（single）上互斥，
// 而且它只复制了视觉、没有 `panellist` / 快捷键 / 折叠这些交互。这一行装上去之后，
// `sidebar.workspaces` 里的上游 `WorkspaceBrowser` 才真正挂在骨架里，而不是挂在自写的 `<section>` 里。
import * as UiSidebarPlugin from "@deepseek-ai/dsh-client-ui-sidebar/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Layout, Locale, Shortcuts, Slots } from "@morlay/zephyr-app/client";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";

@Injectable()
export class SidebarSlots extends fromCordis(UiSidebarPlugin) {
  private readonly slots = inject(Slots);

  private readonly layout = inject(Layout);

  /** 「新建会话」按钮走 `uiWorkspace.startSession()`（它会先选当前/最近的 workspace）。 */
  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly locale = inject(Locale);

  private readonly shortcuts = inject(Shortcuts);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      layout: this.layout,
      uiWorkspace: this.uiWorkspace,
      locale: this.locale,
      shortcuts: this.shortcuts,
    });
  }
}
