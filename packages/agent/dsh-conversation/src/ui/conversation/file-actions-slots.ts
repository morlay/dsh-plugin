// 上游 `ui-file-actions` 的 client 行：右键文件路径时的「显示」与「复制路径」。
//
// 上游 `export const inject = []`，真正的依赖在 `apply` 里的 `ctx.inject([...])`：
// `contextMenus` / `slots` / `locale` / `remote` / `remote.workspaceFiles` / `remote.session`。
import * as UiFileActionsPlugin from "@deepseek-ai/dsh-client-ui-file-actions/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ContextMenus, Locale, Remote, Slots } from "@morlay/zephyr-app/client";

/**
 * \`fileActions\` 的契约：与 \`OpenInApp\` 同理——这一行只注册菜单项，不提供服务。
 */
@Injectable()
export abstract class FileActions {}

@Injectable()
export class FileActionsSlots extends fromCordis(FileActions, UiFileActionsPlugin) {
  private readonly contextMenus = inject(ContextMenus);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      contextMenus: this.contextMenus,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      // 带点的名字是**字面键**。
      "remote.session": this.remote,
      "remote.workspaceFiles": this.remote,
    });
  }
}
