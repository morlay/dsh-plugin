// `WorkspaceEndpoint` 的**客户端形态**：只消费、不实现。
//
// 方法体全部自己写（不像 `session` 组只写两条流），因为**结果封装**也在 face 上：
// `@RemoteClient()` 生成的转发走 `remote.invoke('<组>/<方法>', { request: 第一个实参 })`
// （`zephyr-app/src/remote/decorators.ts` 的 `defineForwarder`），而 `invoke` 把宿主结果**原样**
// 透传；上游 `ClientWorkspaceModel` 按 `result.ok` 解，只有 `$mount` 之后的 `remote.workspace`
// 调用面会包 `RemoteResult`。`follow` 还要逐帧句柄、`initializeDefault` 的实参是取消信号而不是
// `request`——这两条 `invoke` 也给不了。
//
// 组名的 home 是契约上的 `@RemoteGroup({ name })`：这里从契约读（`remoteGroupNameOf`），不另写一份字符串。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import type { WorkspaceRemote } from "@deepseek-ai/dsh-api-workspace-controller/client";
import { inject } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { RemoteClient, groupNameOf } from "@morlay/zephyr-app/remote";
import { WorkspaceEndpoint } from "../endpoint/index.ts";

/** `workspace` 组的客户端契约实例（`ClientWorkspaceModel` 的 `remote` 参数就是它）。 */
@RemoteClient()
export class WorkspaceEndpointClient extends WorkspaceEndpoint {
  /** 调用面的来源：`remote.<组名>` 由 `Remote` 按 descriptor 回落，本类不持有上游实例。 */
  protected readonly remote = inject(Remote);

  /**
   * 这一组的组名（wire 上的 `workspace`）。
   *
   * 消费方要按名字等这一组挂上时用它（`remote.whenNamespace(client.name)`），不手抄字符串。
   * @returns wire 上的组名。
   */
  get name(): string {
    return this.groupName();
  }

  // 一元方法用 `async`：缺面时报的是 **rejection** 而不是同步抛出（调用方按上游的返回类型等 Promise）。

  // 流式方法同步返回逐帧面（上游 `RemoteStreamHandle`：`AsyncIterable` + `send` / `end` / `dispose`）。

  override follow(
    ...args: Parameters<WorkspaceRemote["follow"]>
  ): ReturnType<WorkspaceRemote["follow"]> {
    return this.face().follow(...args);
  }

  /**
   * `remote.<组名>` 的调用面。
   *
   * 缺了**不静默**：没挂上就抛在调用处，不漂成上游内部的 `Cannot read properties of undefined`。
   * @returns 这一组的方法面（与上游 `WorkspaceRemote` 同形）。
   */
  private face(): WorkspaceRemote {
    // 一次断言：`remote.<组名>` 的方法表就是这一面（`Record<string, unknown>` → 上游面）；
    // 缺了在下面抛，不收窄成双断言。
    const face = remoteNamespaceOf(this.remote, this.groupName()) as WorkspaceRemote | undefined;
    if (face === undefined) {
      throw new Error(
        `remote.${this.groupName()} 还没有挂载：等 remote.whenNamespace("${this.groupName()}") 之后再调用`,
      );
    }
    return face;
  }

  /**
   * 组名。唯一 home 是契约上的 `@RemoteGroup({ name })`——这里从契约读，不另写一份字符串。
   * @returns wire 上的组名（`workspace`）。
   */
  private groupName(): string {
    return groupNameOf(this.constructor);
  }
}
