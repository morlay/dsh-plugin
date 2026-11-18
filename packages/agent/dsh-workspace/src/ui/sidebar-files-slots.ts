// 右栏的「文件夹」标签（上游 `ui-sidebar-files` 的 client 半）。
//
// 它给右栏注册一类 tab（`files`）：目录树 + 文件预览 + 快捷键（`workspace.files`）。
// 依赖按 cordis 服务名读（`sidebarRight` / `sidebarRightTabs` / 「工作区文件组」）——
// 那三个由上游自己的行发布，**不要放进 deps**：我们的适配行实例只绑契约上声明的方法，
// 上游要的 `commandTarget` / `openTabFromTarget` 不在契约里（放进 deps 拿到的就是一堆 `undefined`）。
import * as UiSidebarFilesPlugin from "@deepseek-ai/dsh-client-ui-sidebar-files/client";
import { TYPERT_REMOTE as WORKSPACE_FILES_REMOTE } from "@deepseek-ai/dsh-api-workspace-files/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Shortcuts, SidebarRight, SidebarRightTabs, Slots } from "@morlay/zephyr-app/client";
import { WORKSPACE_FILES_REMOTE_KEY } from "../endpoint/index.ts";

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

  override async onInit(ctx: Context): Promise<void> {
    // `sidebarRight` / `sidebarRightTabs` / `remote` 全部走字段注入（`SidebarRight` 现在有真面，
    // 含 `commandTarget` / `openTabFromTarget`）——不再按名字读。
    // **「工作区文件组」 要自己挂**：浏览器里没有全局的 remotes 装载（宿主那份 `AppEnv.remotes`
    // 只在宿主链上跑），每个域各自 `$mount` 自己那份 `TYPERT_REMOTE`。少了这一步文件树永远停在
    // 「正在读取…」（「工作区文件组」 是 `undefined`，那次 list 静默失败）。
    const dispose = await this.remote.$mount(WORKSPACE_FILES_REMOTE);
    ctx.effect(() => dispose);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      shortcuts: this.shortcuts,
      sidebarRight: this.sidebarRight,
      sidebarRightTabs: this.sidebarRightTabs,
      // 带点的名字按字面键给：`withDeps` 只按 `Object.hasOwn` 替换。
      [WORKSPACE_FILES_REMOTE_KEY]: this.remote,
    });
  }
}
