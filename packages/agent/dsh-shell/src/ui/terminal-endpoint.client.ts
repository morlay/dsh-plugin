// `TerminalEndpoint` 的**客户端形态**：只消费、不实现。
//
// 方法体一个都不写：`@RemoteClient()` 的 `defineForwarder` **先走 `face()`**（`$mount` 之后的
// `remote.<组名>` 调用面：按 descriptor 拼命名参数、流式方法直接给 `RemoteStreamHandle`），所以
// 多参、流式都不需要手写转发；`face()` 没挂上时它抛在调用处（不回落 unary `invoke`，否则错点会漂到
// `this.remote.x is not a function`）。
//
// 挂载也归它自己（`onInit` 里 `$mount(remoteDescriptorsOf(TerminalEndpoint))`）：浏览器里没有全局的
// remotes 装载（`provideClientModules` 只在宿主装），每个域挂自己那份。少了这一步 `remote.terminal`
// 永远是 `undefined`，右栏终端打开就炸在调用处。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { TerminalEndpoint } from "@morlay/dsh-shell/endpoint";

/** `terminal` 组的客户端契约实例（`ClientTerminals` 的 `remote` 参数就是它）。 */
@RemoteClient()
export class TerminalEndpointClient extends TerminalEndpoint implements OnInit {
  /** 调用面的来源：`remote.<组名>` 由 `Remote` 按 descriptor 回落，本类不持有上游实例。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(TerminalEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${this.groupName()} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * 这一组的面挂上没有（本行 `onInit` 的 `$mount` 之后才有）。
   * @returns 有面时 `true`。
   */
  get mounted(): boolean {
    return remoteNamespaceOf(this.remote, this.groupName()) !== undefined;
  }

  /**
   * `remote.<组名>` 的调用面。
   *
   * 缺了**不静默**：没挂上就抛在调用处，不漂成上游内部的 `Cannot read properties of undefined`。
   * @returns 这一组的方法面（含逐帧句柄）。
   */
  private face(): TerminalRemote {
    // 一次断言：`remote.<组名>` 的方法表就是这一面（`Record<string, unknown>` → 契约面）；
    // 缺了在下面抛，不收窄成 `as unknown as`。
    const face = remoteNamespaceOf(this.remote, this.groupName()) as TerminalRemote | undefined;
    if (face === undefined) {
      throw new Error(
        `remote.${this.groupName()} 还没有挂载：TerminalEndpointClient 的 onInit 必须先于消费终端的那一行`,
      );
    }
    return face;
  }

  /**
   * 组名。唯一 home 是契约上的 `@RemoteGroup({ name })`——这里从契约读，不另写一份字符串。
   * @returns wire 上的组名（`terminal`）。
   */
  private groupName(): string {
    return groupNameOf(this.constructor);
  }
}
