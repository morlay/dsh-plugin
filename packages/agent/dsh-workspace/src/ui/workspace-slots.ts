// 工作区域的行：`ui-workspace`（工作区与会话树，对外面 `ctx.uiWorkspace`）。
//
// 这一行**不** `inject` 会话控制器，按服务名读 `session-controller`：`SessionController` 的 home 在对话域，
// 而对话域反过来依赖 workspace 的宿主面——直接 import 就是一条反向边（环）。装配面保证
// `provideSessions()` 排在 `provideWorkspaceSlots()` 之前，mount 时它已经发布（与同文件读
// `contextMenus` 同一口径，也与 `SessionQueryRdb` 读 `agents` 同一套用法）。
import * as UiWorkspacePlugin from "@deepseek-ai/dsh-client-ui-workspace/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis, kFace } from "@morlay/zephyr/compat";
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
import { WorkspaceController } from "@morlay/dsh-workspace/ui";
import { UiWorkspace } from "./ui-workspace.token.ts";
import { DIRECTORY_PICKER_REMOTE_KEY } from "../endpoint/index.ts";

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

  /** 兄弟行是否已经发布过 `uiWorkspace`（发布侧幂等守卫用；注入填充早于 `onInit`，与运行时读等价）。 */
  private readonly publishedUiWorkspace = inject.optional(UiWorkspace);

  /** 会话目录读面（`sessions`）：合同在会话域的中立契约面，UI 只要读它。 */
  private readonly sessions = inject(SessionController);

  override async onInit(ctx: Context): Promise<void> {
    // `ui-workspace` 的 inject 声明：`workspaces`（由 `workspace-controller` 行提供）、
    // `locale` / `layout` / `shortcuts` / `remoteAccess`（我们的契约）、`remote.directoryPicker`（远程子面）。
    // 行内菜单的结构化接口：`ContextMenuSlots` 在自己的行 ctx 上发布，装配期被映射成 `ContextMenus` 令牌，
    // 所以读侧走 `inject(ContextMenus)`（按名字 `reflect.get` 只会拿回 `any`）。
    // 会话控制器：走令牌（合同已上移到 `@morlay/dsh-session/contract`，不构成包级环），不按名字读。
    await this.mount(ctx, undefined, {
      contextMenus: this.contextMenus,
      sessions: this.sessions,
      slots: this.slots,
      remote: this.remote,
      locale: this.locale,
      layout: this.layout,
      shortcuts: this.shortcuts,
      remoteAccess: this.remoteAccess,
      workspaces: this.workspaces,
      // 带点的名字要按**字面键**给出（`fromCordis` 的 deps 校验逐字匹配）。
      [DIRECTORY_PICKER_REMOTE_KEY]: this.remote,
    });
    // 上游 `apply` 里 `new UiWorkspaceService(ctx, 'uiWorkspace')` 注册在**行 ctx** 上：兄弟行按名字
    // 读（`ctx.uiWorkspace`）时看不到，所以要把它显式发布到根 ctx。`kFace` 就是那份上游实例。
    const uiWorkspace = this[kFace];
    // 守卫读的是**我们自己的令牌**（`inject.optional`），发布仍按上游协议名走 `reflect.provide`——
    // 按名字读只会拿回 `any`，而这里需要的只是「有没有」。
    if (uiWorkspace !== undefined && this.publishedUiWorkspace === undefined) {
      ctx.root.reflect.provide("uiWorkspace", uiWorkspace);
    }
  }
}
