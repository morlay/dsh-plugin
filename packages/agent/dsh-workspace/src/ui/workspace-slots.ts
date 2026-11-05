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

  override async onInit(ctx: Context): Promise<void> {
    // `ui-workspace` 的 inject 声明：`workspaces`（由 `workspace-controller` 行提供）、
    // `locale` / `layout` / `shortcuts` / `remoteAccess`（我们的契约）、`remote.directoryPicker`（远程子面）。
    // 行内菜单的结构化接口：`ContextMenuSlots` 在自己的行 ctx 上 `ctx.provide('contextMenus', …)`，
    // 清单里它排在前面。**不写进 `inject`**：它是上游的行内服务、没有实现类可注入。
    const contextMenus = (
      ctx as unknown as { root: { reflect: { get(name: string, strict?: boolean): unknown } } }
    ).root.reflect.get("contextMenus", false);
    // **按名字读会话控制器**（不 inject 那个令牌）：`SessionController` 的 home 在对话域，而对话域反过来
    // 依赖 workspace 的宿主面——直接 import 就会成环。装配面把 `provideSessions()` 排在
    // `provideWorkspaceSlots()` 之前，这一行 mount 时它已经发布了（与上面读 `contextMenus` 同一手法）。
    const sessions = (
      ctx as unknown as { root: { reflect: { get(name: string, strict?: boolean): unknown } } }
    ).root.reflect.get("session-controller", false);
    await this.mount(ctx, undefined, {
      contextMenus,
      sessions,
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
    if (uiWorkspace !== undefined) {
      const { reflect } = ctx.root as unknown as {
        reflect: {
          get(name: string, strict?: boolean): unknown;
          provide(name: string, value: unknown): void;
        };
      };
      if (reflect.get("uiWorkspace", false) === undefined)
        reflect.provide("uiWorkspace", uiWorkspace);
    }
  }
}
