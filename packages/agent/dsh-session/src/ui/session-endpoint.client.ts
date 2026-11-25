// `SessionEndpoint` 的**客户端形态**：只消费、不实现。
//
// 只有两个方法自己写（`follow` / `control`）：`@RemoteClient()` 生成的转发走
// `remote.invoke('<组>/<方法>', { request: 第一个实参 })`（`zephyr-app/src/remote/decorators.ts`
// 的 `defineForwarder`）——这一组的其余方法都是**零参或单参 unary**，那个形状与 wire 一致；
// 两个流式方法不成立：`invoke` 只带第一个实参，也没有逐帧通道。它们走 `$mount` 之后的
// `remote.session` 调用面（按 descriptor 拼命名参数、直接给逐帧句柄）。
//
// 组名的 home 是契约上的 `@RemoteGroup({ name })`：这里从契约读（`remoteGroupNameOf`），不另写一份字符串。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { SessionEndpoint } from "@morlay/dsh-session/endpoint";
import type {
  SessionControlFrame,
  SessionFollowFrame,
  SessionFollowRequest,
} from "@morlay/dsh-session/endpoint";

/** `remote.session` 面里本文件手写的那两条流（其余方法由生成的转发覆盖）。 */
interface SessionStreamFace {
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>;
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame>;
}

/** `session` 组的客户端契约实例。 */
@RemoteClient()
export class SessionEndpointClient extends SessionEndpoint implements OnInit {
  /** 转发目标：unary 走 `remote.invoke('<组>/<方法>', { request })`，流式走 `remote.session` 面。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   *
   * 描述符从契约编译（`remoteDescriptorsOf(SessionEndpoint)`，与宿主侧 `registerRemoteGroup` 同一份
   * 声明）：不 `$mount` 上游的 `TYPERT_REMOTE`——那是**上游控制器**的声明，不是我们的 wire 契约。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(SessionEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${this.groupName()} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * 这一组的面挂上没有（`RemoteMountsDefault` 的 `$mount` 在它的 `onInit` 里跑）。
   * @returns 有面时 `true`。
   */
  get mounted(): boolean {
    return remoteNamespaceOf(this.remote, this.groupName()) !== undefined;
  }

  // 流式方法同步返回逐帧面（与上游 `RemoteStreamHandle` 同形，多出 `send` / `end` / `dispose`）。

  override follow(
    ...args: Parameters<SessionEndpoint["follow"]>
  ): ReturnType<SessionEndpoint["follow"]> {
    return this.face().follow(...args);
  }

  override control(
    ...args: Parameters<SessionEndpoint["control"]>
  ): ReturnType<SessionEndpoint["control"]> {
    return this.face().control(...args);
  }

  /**
   * 读一页历史（上游 `SessionManager` 按这个名字取用；wire 上仍走 `session/page`）。
   *
   * 客户端 API 名 ≠ wire 方法名，这层差异由**客户端形态**负责：`LiveSessionRemotes` 与其它消费方
   * 直通，不必各自知道这个别名。
   * @param args - 与 `page` 相同的实参。
   * @returns 与 `page` 相同的应答。
   */
  readPage(...args: Parameters<SessionEndpoint["page"]>): ReturnType<SessionEndpoint["page"]> {
    return this.page(...args);
  }

  /**
   * `remote.<组名>` 的调用面。
   *
   * 缺了**不静默**：没挂上就抛在调用处，不漂成上游内部的 `Cannot read properties of undefined`。
   * @returns 这一组的流式方法面。
   */
  private face(): SessionStreamFace {
    // 一次断言：`remote.<组名>` 的方法表就是这一面（`Record<string, unknown>` → 契约面）；
    // 缺了在下面抛，不收窄成双断言。
    const face = remoteNamespaceOf(this.remote, this.groupName()) as SessionStreamFace | undefined;
    if (face === undefined) {
      throw new Error(
        `remote.${this.groupName()} 还没有挂载：等 remote.whenNamespace("${this.groupName()}") 之后再调用`,
      );
    }
    return face;
  }

  /**
   * 组名。唯一 home 是契约上的 `@RemoteGroup({ name })`——这里从契约读，不另写一份字符串。
   * @returns wire 上的组名（`session`）。
   */
  private groupName(): string {
    return groupNameOf(this.constructor);
  }
}