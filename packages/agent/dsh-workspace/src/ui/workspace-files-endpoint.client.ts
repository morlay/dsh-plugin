// `WorkspaceFilesEndpoint` 的**客户端形态**：只消费、不实现。
//
// 挂载也归它自己（`onInit` 里 `$mount(remoteDescriptorsOf(WorkspaceFilesEndpoint))`）：右栏「文件夹」
// 标签与 `file` 资源 provider 都读 `remote.workspaceFiles`，那一面只有挂上 descriptor 之后才存在
// （少了它文件树永远停在「正在读取…」）。描述符从本包的 `@RemoteGroup` 契约编译（与宿主侧
// `registerRemoteGroup` 同一份声明），不 `$mount` 上游的 `TYPERT_REMOTE`。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { WorkspaceFilesEndpoint } from "@morlay/dsh-workspace/endpoint";

/** `workspaceFiles` 组的客户端契约实例。 */
@RemoteClient()
export class WorkspaceFilesEndpointClient extends WorkspaceFilesEndpoint implements OnInit {
  /** 转发目标：`remote.workspaceFiles`（`$mount` 之后的调用面）。 */
  protected readonly remote = inject(Remote);

  /**
   * 这一组的组名（wire 上的 `workspaceFiles`）：消费方拼 deps 键与按名字等挂载时用它，不手抄字符串。
   * @returns wire 上的组名。
   */
  get name(): string {
    return groupNameOf(this.constructor);
  }

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(WorkspaceFilesEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${groupNameOf(WorkspaceFilesEndpoint)} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
