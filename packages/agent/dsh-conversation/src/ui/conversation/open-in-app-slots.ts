// 上游 `ui-open-in-app` 的 client 行：文件 / 会话的「在应用里打开」与右上角的 Open In 分体按钮。
//
// 它同时提供三块能力，缺一块都表现为「右键菜单是个空壳 / 右上角没有按钮」：
//   1. `target: 'file'` 的菜单项（`open-in-app.file`）；
//   2. `target: 'session'` 的菜单项（`open-in-app.reveal`，在访达中显示）；
//   3. 会话标题栏的 Open In… 分体按钮（注册在 `conversation.session.header.utilities`）。
//
// 上游的 `export const inject` 是 11 个**服务名**：全部由装配面按字面键交进去。
import * as UiOpenInAppPlugin from "@deepseek-ai/dsh-client-ui-open-in-app/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ContextMenus, Layout, Locale, Remote, Shortcuts, Slots } from "@morlay/zephyr-app/client";
import { SessionControllerDefault } from "../session-controller.service.ts";
import { SidebarRight, SidebarRightTabs } from "../ports.ts";

/**
 * \`openInApp\` 的契约：上游这一行**不提供任何服务**，只往槽位与菜单表里注册条目。
 *
 * 写出来是为了让 \`fromCordis(契约, 实现)\` 的双参形态保持统一（装任何上游实现之前先说清它的面，
 * 哪怕这个面是「没有」）。
 */
@Injectable()
export abstract class OpenInApp {}

@Injectable()
export class OpenInAppSlots extends fromCordis(OpenInApp, UiOpenInAppPlugin) {
  private readonly contextMenus = inject(ContextMenus);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  private readonly sessions = inject(SessionControllerDefault);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly shortcuts = inject(Shortcuts);

  private readonly layout = inject(Layout);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      contextMenus: this.contextMenus,
      sidebarRight: this.sidebarRight,
      sidebarRightTabs: this.sidebarRightTabs,
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      // 带点的名字是**字面键**：点号在名字里，不是两级属性。
      "remote.session": this.remote,
      "remote.workspaceFiles": this.remote,
      shortcuts: this.shortcuts,
      layout: this.layout,
    });
  }
}
