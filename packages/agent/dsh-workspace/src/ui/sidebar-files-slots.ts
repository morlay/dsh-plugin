// 右栏的「文件夹」标签（上游 `ui-sidebar-files` 的 client 半）。
//
// **独立组件**（留本域）：只依赖 `sidebarRight` / `sidebarRightTabs`（框架通用令牌）与本域的「工作区文件组」
// 数据面，不需要 `uiSession` 这类跨域 UI 上下文。
//
// 它给右栏注册一类 tab（`files`）：目录树 + 文件预览 + 快捷键（`workspace.files`）。
// 依赖按 cordis 服务名读（`sidebarRight` / `sidebarRightTabs` / 「工作区文件组」）——
// 那三个由上游自己的行发布，**不要放进 deps**：我们的适配行实例只绑契约上声明的方法，
// 上游要的 `commandTarget` / `openTabFromTarget` 不在契约里（放进 deps 拿到的就是一堆 `undefined`）。
import * as UiSidebarFilesPlugin from "@deepseek-ai/dsh-client-ui-sidebar-files/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Shortcuts, SidebarRight, SidebarRightTabs, Slots } from "@morlay/zephyr-app/client";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { WorkspaceFilesEndpointClient } from "./workspace-files-endpoint.client.ts";

@Injectable()
export class SidebarFilesSlots extends fromCordis(UiSidebarFilesPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly shortcuts = inject(Shortcuts);

  /** `SidebarRight` 现在有真面（含 `commandTarget` / `openTabFromTarget`），走注入。 */
  private readonly sidebarRight = inject(SidebarRight);

  /** `SidebarRightTabs` 有真面令牌，走注入。 */
  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  /** 「工作区文件组」 的客户端形态：它自己的 `onInit` 挂上那一组（这条注入就是「挂载先于消费」的排序边）。 */
  private readonly workspaceFiles = inject(WorkspaceFilesEndpointClient);

  override async onInit(ctx: Context): Promise<void> {
    // `sidebarRight` / `sidebarRightTabs` / `remote` 全部走字段注入（`SidebarRight` 现在有真面，
    // 含 `commandTarget` / `openTabFromTarget`）——不再按名字读。
    // **「工作区文件组」 的 descriptor 由 `WorkspaceFilesEndpointClient` 挂**（上面那条注入保证它先跑）：
    // 浏览器里没有全局的 remotes 装载，每个域各自挂自己那份，挂载是客户端形态自己的事。
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      shortcuts: this.shortcuts,
      sidebarRight: this.sidebarRight,
      sidebarRightTabs: this.sidebarRightTabs,
      // 带点的名字按字面键给：`withDeps` 只按 `Object.hasOwn` 替换。
      [remoteNamespaceKey(this.workspaceFiles.name)]: this.remote,
    });
  }
}
