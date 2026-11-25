// `CommandEndpoint` 的**客户端形态**：只消费、不实现。
//
// `@RemoteClient()` 注册成 provider 并给契约里声明的每个方法生成转发（走 `remote.invoke`）。
// 挂载也归它自己：上游消费方（`ui-commands` 的目录）读的是 `ctx.remote.commands`——那是**按 namespace 的**面，
// 只有 `$mount` 过 descriptor 才有。我们的组不在上游 `TYPERT_REMOTE` 里，所以这份 descriptor 由契约自己编译
// （`remoteDescriptorsOf`，与宿主侧 `registerRemoteGroup` 成对）。
//
// `remote` 字段在这里显式声明：契约类**不**继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { CommandEndpoint } from "@morlay/dsh-command/endpoint";
import { RemoteClient, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

/** `commands` 组的客户端契约实例。 */
@RemoteClient()
export class CommandEndpointClient extends CommandEndpoint implements OnInit {
  /** 转发目标：上游实例面（`remote.upstream.<group>`）。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    const dispose = await this.remote.$mount(remoteDescriptorsOf(CommandEndpoint));
    ctx.effect(() => dispose);
  }
}
