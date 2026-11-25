// 右栏的「终端」标签（上游 `ui-sidebar-terminal`），以及它要的 `webTerminals` client 服务。
//
// `webTerminals` 由上游 `api/terminal-controller` 的 client 半提供（`ClientTerminals`），
// 但那个包没有 apply——它就是一个 `Service` 子类，需要有人 `new` 出来（构造里 `super(ctx, 'webTerminals')`）。
// 放在这一行里建：整条链只有右栏的终端 tab 用它。
import * as UiSidebarTerminalPlugin from "@deepseek-ai/dsh-client-ui-sidebar-terminal/client";
import { ClientTerminals } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Shortcuts, SidebarRight, SidebarRightTabs, Slots, Theme } from "@morlay/zephyr-app/client";
import { TerminalEndpointClient } from "./terminal-endpoint.client.ts";

/** `ctx.webTerminals`：浏览器侧的终端视图与进程清理面。 */
@Injectable()
export class WebTerminalsDefault implements OnInit {
  // `inject` 是**字段初始化器**：装配期按字段上的占位对象换成实例。写在方法体里拿到的是占位对象
  // （类型上装作是终端面，调用时直接 `is not a function`）。
  private readonly terminal = inject(TerminalEndpointClient);

  /** `onInit` 里建出来的 `webTerminals`（上游按这个名字读它，见 `SidebarTerminalSlots` 的 deps）。 */
  private webTerminals: ClientTerminals | undefined;

  /**
   * 建好的 `webTerminals`。
   *
   * `onInit` 之后才有：装配顺序（`TerminalEndpointClient` → 本行 → `SidebarTerminalSlots`）保证消费方
   * 读到时它已经在了；不在就抛，不让 `undefined` 漂到上游去。
   * @returns 终端视图与进程清理面。
   */
  get terminals(): ClientTerminals {
    if (this.webTerminals === undefined) {
      throw new Error("WebTerminalsDefault.onInit 还没跑：装配顺序里本行排在了消费方之后");
    }
    return this.webTerminals;
  }

  /**
   * 建 `webTerminals`（上游 client 半的入口实例）。
   * @param ctx - 本行 ctx：服务随本行卸载（`super(ctx, 'webTerminals')` 注册在它上面）。
   * @returns 装配完成。
   */
  async onInit(ctx: Context): Promise<void> {
    // 时序守卫：`terminal` 那一面由 `TerminalEndpointClient.onInit` 的 `$mount` 登记，而本行注入它
    // （注入就是排序边）。这一面缺了说明有人把客户端形态换成了不挂载的替身：在这里就报，
    // 别等到打开终端 tab 才在调用处炸成 `Cannot read properties of undefined (reading 'environment')`。
    if (!this.terminal.mounted) {
      throw new Error("terminal 那组 remote 没挂上：提供 TerminalEndpointClient（它的 onInit 负责挂载）");
    }
    // 传**本行 ctx**（不是 `ctx.root`）：子能读父，而服务生命周期随本行卸载（挂根上就漏了）。
    // 跨行的读取（`SidebarTerminalSlots` 装上游终端标签）由它显式取实例传给 deps，不按名字读 store。
    // 清理在上游构造里（同一个 ctx 的 `effect`），这里不重复挂。
    this.webTerminals = new ClientTerminals(ctx as never, this.terminal);
  }
}

@Injectable()
export class SidebarTerminalSlots extends fromCordis(UiSidebarTerminalPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly theme = inject(Theme);

  private readonly shortcuts = inject(Shortcuts);

  /** `SidebarRight` 现在有真面（`SidebarRightFace = Context["sidebarRight"]`），走注入。 */
  private readonly sidebarRight = inject(SidebarRight);

  /** `sidebarRightTabs` 有真面令牌（`SidebarRightTabsFace`），走注入。 */
  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  /** 上游按 cordis 服务名读 `webTerminals`：从建它的那一行**显式取实例**，不按名字读 store。 */
  private readonly webTerminals = inject(WebTerminalsDefault);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      theme: this.theme,
      shortcuts: this.shortcuts,
      sidebarRight: this.sidebarRight,
      sidebarRightTabs: this.sidebarRightTabs,
      webTerminals: this.webTerminals.terminals,
    });
  }
}
