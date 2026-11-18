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
import { Locale, Remote, Shortcuts, SidebarRightTabs, Slots, Theme } from "@morlay/zephyr-app/client";
import { TerminalRemoteService } from "../endpoint/index.ts";

/** `ctx.webTerminals`：浏览器侧的终端视图与进程清理面。 */
@Injectable()
export class WebTerminalsDefault implements OnInit {
  // `inject` 是**字段初始化器**：装配期按字段上的占位对象换成实例。写在方法体里拿到的是占位对象
  // （类型上装作是 `Remote`，运行期 `$mount` 直接 `is not a function`）。
  private readonly remote = inject(Remote);

  /** `remote.terminal`：按上游嵌套服务名建的令牌（`upstream` 是空对象，不能读它）。 */
  private readonly terminal = inject(TerminalRemoteService);

  async onInit(ctx: Context): Promise<void> {
    // 走契约（`inject(Remote)`）：`$mount` 在契约上，不需要按名字读服务。
    // 「终端组」走**按上游嵌套服务名建的令牌**（`TerminalRemoteService`，名字 `remote.terminal`）——
    // 不能读 `remote.upstream`：那是空对象（`remote.service.ts:297`），读出来永远 `undefined`。

    // 浏览器里没人跑全局的 remotes 清单（`provideClientModules` 只在宿主装）：每个域自己 `$mount`
    // 自己那份 `TYPERT_REMOTE`。少了这一步 「终端组」 永远是 `undefined`。
    await this.remote.$mount(TERMINAL_REMOTE);
    // `ClientTerminals` 是 cordis `Service` 子类：构造里 `super(ctx, 'webTerminals')` 把自己注册进 store。
    // 传**本行 ctx**（不是 `ctx.root`）：子能读父，所以 `ui-sidebar-terminal` 照样读得到 `webTerminals`，
    // 而服务生命周期随本行卸载（挂根上就漏了）。
    const terminals = new ClientTerminals(ctx as never, this.terminal as never);
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

  /** `sidebarRightTabs` 有真面令牌（`SidebarRightTabsFace`），走注入。 */
  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  override async onInit(ctx: Context): Promise<void> {
    // 剩下两处仍按名字读，各有明确前置（不是「先留着」）：
    // - `sidebarRight`：令牌 `SidebarRight` 现在是 `InjectionToken<unknown>`（票 03 第 3 类同根），
    //   等 `owner-zephyr-casts` 补真面后改 `inject`；
    // - `webTerminals`：本文件另一行 `new ClientTerminals(...)` 注册的服务，还没有令牌，待补。
    const read = (name: string): unknown => ctx.get(name);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      theme: this.theme,
      shortcuts: this.shortcuts,
      sidebarRight: read("sidebarRight"),
      sidebarRightTabs: this.sidebarRightTabs,
      webTerminals: read("webTerminals"),
    });
  }
}
