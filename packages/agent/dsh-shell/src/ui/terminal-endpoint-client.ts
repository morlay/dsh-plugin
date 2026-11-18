// `TerminalEndpoint` 的**客户端形态**：只消费、不实现。
//
// 方法体为什么自己写：`@RemoteClient()` 生成的转发走 `remote.invoke('<组>/<方法>', { request: 第一个实参 })`
// （`remote/decorators.ts` 的 `defineForwarder`）。终端组不是那个形状：wire 上要**多个命名参数**
// （`agentId` / `id` / `request` / `title`），`attach` / `retain` / `watch` 还是流式——`invoke` 只带
// 第一个实参、也没有流式通道。这一组只能走 `$mount` 之后的 `remote.<组名>` 调用面：它按 descriptor
// 拼命名参数、流式方法直接返回 `RemoteStreamHandle`，与上游 `TerminalRemote` 逐字同形。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { inject } from "@morlay/zephyr";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient, remoteGroupNameOf } from "@morlay/zephyr-app/remote";
import { TerminalEndpoint } from "../endpoint/index.ts";

/** `terminal` 组的客户端契约实例（`ClientTerminals` 的 `remote` 参数就是它）。 */
@RemoteClient()
export class TerminalEndpointClient extends TerminalEndpoint implements TerminalRemote {
  /** 调用面的来源：`remote.<组名>` 由 `Remote` 按 descriptor 回落，本类不持有上游实例。 */
  protected readonly remote = inject(Remote);

  /**
   * 这一组的面挂上没有（`RemoteMountsDefault` 的 `$mount` 在它的 `onInit` 里跑）。
   * @returns 有面时 `true`。
   */
  get mounted(): boolean {
    return remoteNamespaceOf(this.remote, this.groupName()) !== undefined;
  }

  // 流式方法（`attach` / `retain` / `watch`）同步返回逐帧面；一元方法用 `async`，缺面时报的是
  // **rejection** 而不是同步抛出（调用方按 `TerminalRemote` 的返回类型等 Promise）。

  override attach(...args: Parameters<TerminalRemote["attach"]>): ReturnType<TerminalRemote["attach"]> {
    return this.face().attach(...args);
  }

  override async close(
    ...args: Parameters<TerminalRemote["close"]>
  ): ReturnType<TerminalRemote["close"]> {
    return await this.face().close(...args);
  }

  override async create(
    ...args: Parameters<TerminalRemote["create"]>
  ): ReturnType<TerminalRemote["create"]> {
    return await this.face().create(...args);
  }

  override async environment(
    ...args: Parameters<TerminalRemote["environment"]>
  ): ReturnType<TerminalRemote["environment"]> {
    return await this.face().environment(...args);
  }

  override async list(
    ...args: Parameters<TerminalRemote["list"]>
  ): ReturnType<TerminalRemote["list"]> {
    return await this.face().list(...args);
  }

  override async rename(
    ...args: Parameters<TerminalRemote["rename"]>
  ): ReturnType<TerminalRemote["rename"]> {
    return await this.face().rename(...args);
  }

  override retain(...args: Parameters<TerminalRemote["retain"]>): ReturnType<TerminalRemote["retain"]> {
    return this.face().retain(...args);
  }

  override async shells(
    ...args: Parameters<TerminalRemote["shells"]>
  ): ReturnType<TerminalRemote["shells"]> {
    return await this.face().shells(...args);
  }

  override watch(...args: Parameters<TerminalRemote["watch"]>): ReturnType<TerminalRemote["watch"]> {
    return this.face().watch(...args);
  }

  /**
   * `remote.<组名>` 的调用面。
   *
   * 缺了**不静默**：没挂上就抛在调用处，不漂成上游内部的 `Cannot read properties of undefined`。
   * @returns 这一组的方法面。
   */
  private face(): TerminalRemote {
    // 一次断言：`remote.<组名>` 的方法表就是这一面（`Record<string, unknown>` → 契约面）；
    // 缺了在下面抛，不收窄成 `as unknown as`。
    const face = remoteNamespaceOf(this.remote, this.groupName()) as TerminalRemote | undefined;
    if (face === undefined) {
      throw new Error(
        `remote.${this.groupName()} 还没有挂载：RemoteMountsDefault 必须排在消费终端的那一行之前`,
      );
    }
    return face;
  }

  /**
   * 组名。唯一 home 是契约上的 `@RemoteGroup({ name })`——这里从契约读，不另写一份字符串。
   * @returns wire 上的组名（`terminal`）。
   */
  private groupName(): string {
    const name = remoteGroupNameOf(this.constructor);
    if (name === undefined) {
      throw new Error("TerminalEndpointClient 没有 @RemoteGroup：组名读不到");
    }
    return name;
  }
}