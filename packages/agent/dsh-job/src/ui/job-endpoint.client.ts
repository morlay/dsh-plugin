// `JobEndpoint` 的**客户端形态**：只消费、不实现。
//
// 它同时是「`job` 那组 remote 由谁挂」的答案：`onInit` 里 `$mount(remoteDescriptorsOf(JobEndpoint))`。
// 描述符从本包的 `@RemoteGroup` 契约编译（与宿主侧 `registerRemoteGroup` 同一份声明），不 `$mount`
// 上游的 `TYPERT_REMOTE`（那是上游控制器的声明）。上游 `ClientJobs` 的 `apply` 里 `const { job } = remote`
// 是**属性读**，挂上之前读到的是空——症状是「面板有入口，点开永远是空列表」。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { JobEndpoint } from "@morlay/dsh-job/endpoint";

/** `job` 组的客户端契约实例。 */
@RemoteClient()
export class JobEndpointClient extends JobEndpoint implements OnInit {
  /** 转发目标：`remote.job`（`$mount` 之后的调用面）。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(JobEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${groupNameOf(JobEndpoint)} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
