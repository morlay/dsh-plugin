// 工作区域的行：`ui-workspace`（工作区与会话树，对外面 `ctx.uiWorkspace`）。
import * as UiWorkspacePlugin from "@deepseek-ai/dsh-client-ui-workspace/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Layout, Locale, Remote, RemoteAccess, SessionRemoteBinding, Shortcuts, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { WorkspaceController } from "@morlay/dsh-workspace/ui";
import { UiWorkspace } from "./ui-workspace.token.ts";

@Injectable()
export class WorkspaceSlots extends fromCordis(UiWorkspace, UiWorkspacePlugin) {
  private readonly sessionRemoteBinding = inject(SessionRemoteBinding);

  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  private readonly locale = inject(Locale);

  private readonly layout = inject(Layout);

  private readonly shortcuts = inject(Shortcuts);

  private readonly remoteAccess = inject(RemoteAccess);

  private readonly workspaces = inject(WorkspaceController);

  protected override async onInit(ctx: Context): Promise<void> {
    // `ui-workspace` 的 inject 声明：`workspaces`（由 `workspace-controller` 行提供）、
    // `locale` / `layout` / `shortcuts` / `remoteAccess`（我们的契约）、`remote.directoryPicker`（远程子面）。
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      slots: this.slots,
      remote: this.remote,
      locale: this.locale,
      layout: this.layout,
      shortcuts: this.shortcuts,
      remoteAccess: this.remoteAccess,
      workspaces: this.workspaces,
      // 带点的名字要按**字面键**给出（`fromCordis` 的 deps 校验逐字匹配）。
      "remote.directoryPicker": this.remote,
    });
  }
}
