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
import { Locale, Remote, Shortcuts, Slots, Theme } from "@morlay/zephyr-app/client";
import { TERMINAL_GROUP } from "../endpoint/index.ts";

/** `ctx.webTerminals`：浏览器侧的终端视图与进程清理面。 */
@Injectable()
export class WebTerminalsDefault implements OnInit {
  // `inject` 是**字段初始化器**：装配期按字段上的占位对象换成实例。写在方法体里拿到的是占位对象
  // （类型上装作是 `Remote`，运行期 `$mount` 直接 `is not a function`）。
  private readonly remote = inject(Remote);

  async onInit(ctx: Context): Promise<void> {
    // 走契约（`inject(Remote)`）：`$mount` / `whenMounted` 都在契约上，不需要按名字读服务。
    // 「终端组」取的是**上游 namespace 的原始对象**——`@RemoteContract` 没为 terminal 建契约（这条链只有
    // 右栏的终端 tab 用它，为一个消费方建契约是过度），所以走契约声明的口子 `remote.upstream[组名]`。

    // 浏览器里没人跑全局的 remotes 清单（`provideClientModules` 只在宿主装）：每个域自己 `$mount`
    // 自己那份 `TYPERT_REMOTE`。少了这一步 「终端组」 永远是 `undefined`。
    await this.remote.$mount(TERMINAL_REMOTE);
    // `ClientTerminals` 是 cordis `Service` 子类：构造里 `super(ctx, 'webTerminals')` 把自己注册进 store。
    // 用**根 ctx** 建，兄弟行（`ui-sidebar-terminal`）按名字才读得到。
    const root = ctx.root;
    const terminals = new ClientTerminals(
      root as never,
      this.remote.upstream[TERMINAL_GROUP] as never,
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
      ctx.get(name);
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
