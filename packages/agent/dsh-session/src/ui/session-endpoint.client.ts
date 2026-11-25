// `SessionEndpoint` 的**客户端形态**：只消费、不实现。
//
// 只有两个方法自己写（`follow` / `control`）：`@RemoteClient()` 生成的转发走 `face()`——即 `$mount`
// 之后的 `remote.session` 调用面（按 descriptor 拼命名参数、直接给逐帧句柄）。两个流式方法在
// `@RemoteClient()` 的 unary 兜底里不成立（`invoke` 只带第一个实参、没有逐帧通道），所以显式转发。
//
// **这一组的 wire 描述符用上游那份**（`SESSION_CONTROLLER_REMOTE`，宿主侧实现就是上游控制器）：
// 契约只管组名、方法名与类型，不再编译第二份 descriptor——两份对不上时只在运行时炸，
// `session/list` 的 `_request` vs `request` 就是这么来的（见 `endpoint/session-controller.remote.ts`）。
//
// 组名的 home 是契约上的 `@RemoteGroup({ name })`：这里从契约读（`remoteGroupNameOf`），不另写一份字符串。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { RemoteClient, groupNameOf } from "@morlay/zephyr-app/remote";
import { SESSION_CONTROLLER_REMOTE, SessionEndpoint } from "@morlay/dsh-session/endpoint";
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
  /** 转发目标：`@RemoteClient()` 生成的方法都走 `remote.<组名>` 面（`face()`）；流式方法自己转发同一面。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   *
   * 挂的是**上游那份**（`SESSION_CONTROLLER_REMOTE`）：宿主侧实现就是上游控制器，wire 描述符只有它
   * 一份。这里不编译我们的组契约——那会造出第二份声明，`session/list` 的 `_request` / `request`
   * 分叉就是这么来的。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(SESSION_CONTROLLER_REMOTE);
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${this.groupName()} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * 这一组的面挂上没有（`$mount` 在 {@link onInit} 里跑，装配完成前读它就是 `false`）。
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