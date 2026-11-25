// 工作区域的行（上游 `ui-workspace` 的 client 半）：工作区与会话树，对外面 `ctx.uiWorkspace`。
//
// **插槽注册在对话域、实现在 workspace 域**：上游 `ui-workspace` 的 `inject` 里有 `uiSession` 与
// `uiSession.sessionStatus`（未读标记）——这两个服务的 home 是会话界面契约面，而 workspace 域反过来
// 被对话域依赖，直接 import 就是包级环。所以这一行（只做「装上游 + 交 deps + 注册槽位」）住在会话域，
// 工作区的数据面（`WorkspaceController` / 远程绑定 / 文件资源）留在 `@morlay/dsh-workspace`。
import * as UiWorkspacePlugin from "@deepseek-ai/dsh-client-ui-workspace/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fixedSyncedConfig } from "@morlay/zephyr-app/client";
import { fromCordis } from "@morlay/zephyr/compat";
import {
  ContextMenus,
  Layout,
  Locale,
  Remote,
  RemoteAccess,
  Shortcuts,
  Slots,
} from "@morlay/zephyr-app/client";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { SessionController } from "@morlay/dsh-session/endpoint";
import { UiSession, UiSessionStatus } from "@morlay/dsh-conversation/contract";
import { WorkspaceController } from "@morlay/dsh-workspace/endpoint";
import { UiWorkspace } from "@morlay/dsh-conversation/contract";
import { directoryPickerGroupName } from "@morlay/dsh-workspace/endpoint";

@Injectable()
export class WorkspaceSlots extends fromCordis(UiWorkspace, UiWorkspacePlugin) {
  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  private readonly locale = inject(Locale);

  private readonly layout = inject(Layout);

  private readonly shortcuts = inject(Shortcuts);

  private readonly remoteAccess = inject(RemoteAccess);

  private readonly workspaces = inject(WorkspaceController);

  /** 行内右键菜单：上游在它自己的行 ctx 上发布，装配期由 `adoptNamedServices` 映射成同名令牌。 */
  private readonly contextMenus = inject(ContextMenus);

  /** 会话目录读面（`sessions`）：合同在会话域的端点面，UI 只要读它。 */
  private readonly sessions = inject(SessionController);

  /** `uiSession`：上游 `ui-workspace` 的 `inject` 声明里有它，读的是未读标记（`uiSession.sessionStatus`）。 */
  private readonly uiSession = inject(UiSession);

  /** `uiSession.sessionStatus` 的子服务：`inject(令牌)` + deps **替换**上游那次按名读。 */
  private readonly uiSessionStatus = inject(UiSessionStatus);

  override async onInit(ctx: Context): Promise<void> {
    // `ui-workspace` 的 inject 声明：`workspaces`（由 `workspace-controller` 行提供）、
    // `locale` / `layout` / `shortcuts` / `remoteAccess`（我们的契约）、`remote.directoryPicker`（远程子面）。
    // 上游 0.2.3 起这份 client 的 `Config` 由 Host 同步（`recentViewLimit`）：没有同步通道时给「未配置」。
    await this.mount(ctx, fixedSyncedConfig(["recentViewLimit"]), {
      contextMenus: this.contextMenus,
      sessions: this.sessions,
      uiSession: this.uiSession,
      // 带点的名字按字面键给出（`fromCordis` 的 deps 校验逐字匹配）。
      "uiSession.sessionStatus": this.uiSessionStatus,
      slots: this.slots,
      remote: this.remote,
      locale: this.locale,
      layout: this.layout,
      shortcuts: this.shortcuts,
      remoteAccess: this.remoteAccess,
      workspaces: this.workspaces,
      [remoteNamespaceKey(directoryPickerGroupName())]: this.remote,
    });
  }
}
