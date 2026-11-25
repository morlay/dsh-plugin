// `SubagentsEndpoint` 的**客户端形态**：只消费、不实现。
//
// 挂载也归它自己（`onInit` 里 `$mount(remoteDescriptorsOf(SubagentsEndpoint))`）：会话界面读的
// 是 `remote.subagents` 这个 namespace 面，那一面只有挂上 descriptor 之后才存在。描述符从契约编译
// （与宿主侧 `registerRemoteGroup` 同一份声明），不 `$mount` 上游的 `TYPERT_REMOTE`——那是
// **上游控制器**的声明，不是我们的 wire 契约。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { SubagentsEndpoint } from "@morlay/dsh-agent/endpoint";

/** `subagents` 组的客户端契约实例。 */
@RemoteClient()
export class SubagentsEndpointClient extends SubagentsEndpoint implements OnInit {
  /** 转发目标：`remote.subagents`（`$mount` 之后的调用面）。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(SubagentsEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${groupNameOf(SubagentsEndpoint)} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
