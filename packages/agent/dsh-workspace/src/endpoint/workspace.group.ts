// `workspace` 组的**两端共用面**：组名、方法名与每个方法的请求/响应形状。
//
// 形状照上游 `api/workspace-controller` 的 descriptor 抄（`namespace: 'workspace'`），但声明在我们这里：
// `endpoint/` 是两端共用的面。类型从上游的 `/types`（请求与应答的 wire 形状）与 `/client`（客户端调用面）
// 子出口取，全是 `import type`：运行期零边。
//
// 组名只有一个 home：下面契约类上的 `@RemoteGroup({ name: "workspace" })`。消费方从契约读
// （`remoteGroupNameOf`）或直接调客户端形态的方法，不另存一份字符串。
import type { WorkspaceRemote } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {
  WorkspaceArchiveValue,
  WorkspaceCreateValue,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceOrderValue,
  WorkspacePinValue,
  WorkspaceValue,
} from "@deepseek-ai/dsh-api-workspace-controller/types";
import {
  RemoteGroup,
  RemoteMethod,
  groupNameOf,
  type RemoteResultWire,
} from "@morlay/zephyr-app/remote";

/**
 * 组名（`workspace`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function workspaceGroupName(): string {
  return groupNameOf(WorkspaceEndpoint);
}

/**
 * 一条命令的应答。
 *
 * 同一条 wire 端点，两端拿到的是**两层的不同东西**：宿主回**裸值**（失败是异常，与上游 `@Remote` 同协议），
 * 客户端 `remote.<组>` 的调用面再把它包成 `RemoteResult`。契约两端共用，所以这里写两者的上界；
 * 两侧实现各自收窄到自己那一半——宿主（`server/workspace-controller.host.ts`）回裸值，
 * `WorkspaceEndpointClient` 回 `RemoteResult`。
 */
type Reply<T> = T | RemoteResultWire<T>;

/**
 * `workspace` 组：工作区的建档 / 改名 / 删除 / 排序、会话的归档与置顶，外加一条目录状态流。
 *
 * 每个 unary 的 wire 参数叫 `request`（与宿主侧 `registerRemoteGroup` 的 `requestOf` 同一约定），
 * 应答是 {@link Reply}；`follow` 是流式，`initializeDefault` 带取消信号。
 */
@RemoteGroup({ name: "workspace" })
export class WorkspaceEndpoint {
  /**
   * 建一个工作区（目录已存在）。
   * @param _request - 目录路径。
   * @returns 新工作区的投影与「是否真的新建了」。
   */
  @RemoteMethod()
  async create(
    _request: Parameters<WorkspaceRemote["create"]>[0],
  ): Promise<Reply<WorkspaceCreateValue>> {
    throw new Error("workspace/create：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 改一个工作区的标题。
   * @param _request - 工作区与提议的标题。
   * @returns 改后的工作区投影。
   */
  @RemoteMethod()
  async rename(_request: Parameters<WorkspaceRemote["rename"]>[0]): Promise<Reply<WorkspaceValue>> {
    throw new Error("workspace/rename：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 删一个工作区（不动它挂的会话）。
   * @param _request - 目标工作区。
   * @returns `{ deleted: true }`。
   */
  @RemoteMethod()
  async delete(
    _request: Parameters<WorkspaceRemote["delete"]>[0],
  ): Promise<Reply<WorkspaceDeleteValue>> {
    throw new Error("workspace/delete：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 把一个工作区挪到另一个之前（缺省挪到末尾）。
   * @param _request - 工作区与可选的锚点。
   * @returns 新的顺序。
   */
  @RemoteMethod()
  async insertBefore(
    _request: Parameters<WorkspaceRemote["insertBefore"]>[0],
  ): Promise<Reply<WorkspaceOrderValue>> {
    throw new Error("workspace/insertBefore：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 把一个会话挪进工作区、落在某个会话之前。
   * @param _request - 工作区、会话与可选的锚点会话。
   * @returns 该工作区的新投影。
   */
  @RemoteMethod()
  async insertSessionBefore(
    _request: Parameters<WorkspaceRemote["insertSessionBefore"]>[0],
  ): Promise<Reply<WorkspaceValue>> {
    throw new Error("workspace/insertSessionBefore：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 归档一个会话（可顺带停掉它正在跑的活动）。
   * @param _request - 会话与可选的活动处置开关。
   * @returns 归档集合。
   */
  @RemoteMethod()
  async archiveSession(
    _request: Parameters<WorkspaceRemote["archiveSession"]>[0],
  ): Promise<Reply<WorkspaceArchiveValue>> {
    throw new Error("workspace/archiveSession：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 取消一个会话的归档。
   * @param _request - 目标会话。
   * @returns 归档集合。
   */
  @RemoteMethod()
  async unarchiveSession(
    _request: Parameters<WorkspaceRemote["unarchiveSession"]>[0],
  ): Promise<Reply<WorkspaceArchiveValue>> {
    throw new Error("workspace/unarchiveSession：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 置顶一个会话。
   * @param _request - 目标会话。
   * @returns 置顶集合。
   */
  @RemoteMethod()
  async pinSession(
    _request: Parameters<WorkspaceRemote["pinSession"]>[0],
  ): Promise<Reply<WorkspacePinValue>> {
    throw new Error("workspace/pinSession：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 取消一个会话的置顶。
   * @param _request - 目标会话。
   * @returns 置顶集合。
   */
  @RemoteMethod()
  async unpinSession(
    _request: Parameters<WorkspaceRemote["unpinSession"]>[0],
  ): Promise<Reply<WorkspacePinValue>> {
    throw new Error("workspace/unpinSession：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 首次使用的工作区：按系统 Documents 目录判定要不要建（幂等）。
   * @param _signal - 调用方生命周期；wire 上不进命名参数（descriptor 的 `cancellation.parameter`）。
   * @returns 新工作区的投影，或「首次初始化不适用」时的 `undefined`。
   */
  @RemoteMethod()
  async initializeDefault(_signal?: AbortSignal): Promise<Reply<WorkspaceValue | undefined>> {
    throw new Error("workspace/initializeDefault：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 工作区目录的状态流：一帧 baseline，之后逐条增量，直到取消。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧面：宿主给 `AsyncIterable`，客户端面是它的 `RemoteStreamHandle`。
   */
  @RemoteMethod({ mode: "stream" })
  follow(_signal?: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    throw new Error("workspace/follow：契约类未实现（宿主侧要在子类里实现它）");
  }
}
