// 右栏的「浏览器」标签（上游 `ui-sidebar-browser` 的 client 行）：文件树 + 预览。
//
// 它注册 `sidebar.right.pane.tab`（正文）与 `.title`（标签标题），两个 key 都是 `browser`。
// 之前没装它，右栏就只有「交付物 / 计划」这些来自其它域的标签，文件浏览整块是空的——
// 那部分是上游写好的，不重写：装上它、把四个依赖显式交给它即可。
import * as UiSidebarBrowserPlugin from "@deepseek-ai/dsh-client-ui-sidebar-browser/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, SidebarRight, SidebarRightTabs, Slots } from "@morlay/zephyr-app/client";

/** 右栏浏览器标签。 */
@Injectable()
export class SidebarBrowserSlots extends fromCordis(UiSidebarBrowserPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      sidebarRight: this.sidebarRight,
      sidebarRightTabs: this.sidebarRightTabs,
    });
  }
}
