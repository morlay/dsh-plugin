// 工作区域的行：`ui-workspace`（工作区与会话树，对外面 `ctx.uiWorkspace`）。
//
// 会话目录按**上游注册名**建一条令牌（`SessionDirectory`，`./session-directory.token.ts`）：上游发布
// `session-controller`，装配期由 `adoptNamedServices` 采纳进这条令牌，所以读侧是强类型的 `ISessions`。
// 不 `inject(SessionController)`：那个令牌叫类名 `"SessionController"`，与注册名对不上、采不到；
// 也不 import 对话域（对话域反向依赖 workspace 的宿主面，直接 import 就是环）。
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
import { SessionDirectory } from "./session-directory.token.ts";
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

  /** 会话目录读面（上游 `session-controller`）：按注册名建的令牌，装配期被采纳。 */
  private readonly sessions = inject(SessionDirectory);

  override async onInit(ctx: Context): Promise<void> {
    // `ui-workspace` 的 inject 声明：`workspaces`（由 `workspace-controller` 行提供）、
    // `locale` / `layout` / `shortcuts` / `remoteAccess`（我们的契约）、`remote.directoryPicker`（远程子面）。
    // 行内菜单的结构化接口：`ContextMenuSlots` 在自己的行 ctx 上发布，装配期被映射成 `ContextMenus` 令牌，
    // 所以读侧走 `inject(ContextMenus)`（按名字 `reflect.get` 只会拿回 `any`）。
    // 会话目录：`inject(SessionDirectory)`（令牌取上游注册名，装配期被采纳；强类型、无断言）。
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
