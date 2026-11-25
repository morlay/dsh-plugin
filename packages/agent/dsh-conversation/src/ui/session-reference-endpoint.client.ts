// `SessionReferenceEndpoint` 的**客户端形态**：只消费、不实现。
//
// `@` 菜单的**会话候选** namespace（`remote.sessionReferenceResolver`）由它在 `onInit` 里挂上：
// 浏览器里没有全局的 remotes 装载，每个域各自挂自己那份 descriptor（从本包的 `@RemoteGroup` 契约编译，
// 与宿主侧 `registerRemoteGroup` 同一份声明）。少了这一行，`ui-reference` 的 `candidates(...)` 读到的是
// `undefined`，界面表现是「`@` 候选永远为空」。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { SessionReferenceEndpoint } from "@morlay/dsh-conversation/endpoint";

/** `sessionReferenceResolver` 组的客户端契约实例。 */
@RemoteClient()
export class SessionReferenceEndpointClient extends SessionReferenceEndpoint implements OnInit {
  /** 转发目标：`remote.sessionReferenceResolver`（`$mount` 之后的调用面）。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(SessionReferenceEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${groupNameOf(SessionReferenceEndpoint)} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
