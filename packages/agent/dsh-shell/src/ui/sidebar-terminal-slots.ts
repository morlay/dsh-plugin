// 右栏的「终端」标签（上游 `ui-sidebar-terminal`），以及它要的 `webTerminals` client 服务。
//
// `webTerminals` 由上游 `api/terminal-controller` 的 client 半提供（`ClientTerminals`），
// 但那个包没有 apply——它就是一个 `Service` 子类，需要有人 `new` 出来（构造里 `super(ctx, 'webTerminals')`）。
// 放在这一行里建：整条链只有右栏的终端 tab 用它。
import * as UiSidebarTerminalPlugin from "@deepseek-ai/dsh-client-ui-sidebar-terminal/client";
import { ClientTerminals } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { TYPERT_REMOTE as TERMINAL_REMOTE } from "@deepseek-ai/dsh-api-terminal-controller/remote";
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Shortcuts, Slots, Theme } from "@morlay/zephyr-app/client";
import { TERMINAL_GROUP } from "../endpoint/index.ts";

/** `ctx.webTerminals`：浏览器侧的终端视图与进程清理面。 */
@Injectable()
export class WebTerminalsDefault implements OnInit {
  async onInit(ctx: Context): Promise<void> {
    // 「终端组」 要取**真服务**：`inject(Remote)` 给的是适配行实例，而它只绑契约上声明的成员
    // （`Remote` 契约不列 namespace）——从它读 `terminal` 是 `undefined`，终端的第一次
    // `remote.environment(...)` 就会炸成 `Cannot read properties of undefined (reading 'environment')`。
    const remote = (ctx as unknown as { get(name: string): unknown }).get("remote") as {
      readonly terminal: TerminalRemote;
      $mount(contribution: unknown): Promise<() => Promise<void>>;
    };
    // 浏览器里没人跑全局的 remotes 清单（`provideClientModules` 只在宿主装）：每个域自己 `$mount`
    // 自己那份 `TYPERT_REMOTE`。少了这一步 「终端组」 永远是 `undefined`。
    await remote.$mount(TERMINAL_REMOTE);
    // `ClientTerminals` 是 cordis `Service` 子类：构造里 `super(ctx, 'webTerminals')` 把自己注册进 store。
    // 用**根 ctx** 建，兄弟行（`ui-sidebar-terminal`）按名字才读得到。
    const root = (ctx as unknown as { root: Context }).root;
    const terminals = new ClientTerminals(
      root as never,
      (remote as unknown as Record<string, unknown>)[TERMINAL_GROUP] as never,
    );
    ctx.effect(() => () => {
      void (terminals as unknown as { dispose?: () => unknown }).dispose?.();
    });
  }
}

@Injectable()
export class SidebarTerminalSlots extends fromCordis(UiSidebarTerminalPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly theme = inject(Theme);

  private readonly shortcuts = inject(Shortcuts);

  override async onInit(ctx: Context): Promise<void> {
    // 同 `SidebarFilesSlots`：上游要的 `sidebarRight.commandTarget` / `sidebarRightTabs` 不在我们的
    // 契约里，从真 cordis 服务取（`get(name)` 不传 strict 就是非严格读）。
    const read = (name: string): unknown =>
      (ctx as unknown as { get(n: string): unknown }).get(name);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      theme: this.theme,
      shortcuts: this.shortcuts,
      sidebarRight: read("sidebarRight"),
      sidebarRightTabs: read("sidebarRightTabs"),
      webTerminals: read("webTerminals"),
    });
  }
}
