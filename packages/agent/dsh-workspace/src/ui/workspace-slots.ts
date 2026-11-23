// 工作区域的行：`ui-workspace`（工作区与会话树，对外面 `ctx.uiWorkspace`）。
//
// 这一行**不** `inject` 会话控制器，按服务名读 `session-controller`：`SessionController` 的 home 在对话域，
// 而对话域反过来依赖 workspace 的宿主面——直接 import 就是一条反向边（环）。装配面保证
// `provideSessions()` 排在 `provideWorkspaceSlots()` 之前，mount 时它已经发布（与同文件读
// `contextMenus` 同一口径，也与 `SessionQueryRdb` 读 `agents` 同一套用法）。
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
  SessionRemoteBinding,
  Shortcuts,
  Slots,
} from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/endpoint";
import { UiSession, UiSessionStatus } from "@morlay/zephyr-app/client";
import { WorkspaceController } from "@morlay/dsh-workspace/ui";
import { UiWorkspace } from "@morlay/dsh-workspace/contract";
import { directoryPickerGroupName } from "../endpoint/index.ts";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";

@Injectable()
export class WorkspaceSlots extends fromCordis(UiWorkspace, UiWorkspacePlugin) {
  private readonly sessionRemoteBinding = inject(SessionRemoteBinding);

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

  /**
   * `uiSession`（上游 `ui-session` 行的服务，子服务 `uiSession.sessionStatus` 由 `ui-session-status` 行发布）：
   * 上游 `ui-workspace` 的 `inject` 声明里有这两个名字，读的是未读标记。装配顺序上
   * `provideSessionShell()` / `provideSessionStatusUi()` 必须排在 `provideWorkspaceUi()` 之前。
   */
  private readonly uiSession = inject(UiSession);

  /** `uiSession.sessionStatus` 的子服务：`inject(令牌)` + deps **替换**上游那次按名读（见令牌的注释）。 */
  private readonly uiSessionStatus = inject(UiSessionStatus);

  override async onInit(ctx: Context): Promise<void> {
    // `ui-workspace` 的 inject 声明：`workspaces`（由 `workspace-controller` 行提供）、
    // `locale` / `layout` / `shortcuts` / `remoteAccess`（我们的契约）、`remote.directoryPicker`（远程子面）。
    // 行内菜单的结构化接口：`ContextMenuSlots` 在自己的行 ctx 上发布，装配期被映射成 `ContextMenus` 令牌，
    // 所以读侧走 `inject(ContextMenus)`（按名字 `reflect.get` 只会拿回 `any`）。
    // 会话目录：走令牌（合同已上移到 `@morlay/dsh-session/endpoint`，不构成包级环），不按名字读。
    // 上游 0.2.3 起这份 client 的 `Config` 由 Host 同步（`recentViewLimit`）：没有同步通道时给"未配置"。
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
      // 带点的名字要按**字面键**给出（`fromCordis` 的 deps 校验逐字匹配）。
      [remoteNamespaceKey(directoryPickerGroupName())]: this.remote,
    });
  }
}
