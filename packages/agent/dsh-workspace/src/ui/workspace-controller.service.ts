// workspaces 行（浏览器侧）：**只提供服务**，数据面走 「工作区组」。
//
// 契约面与上游 `IWorkspaces` 一致（`ui-workspace` 的每个入口都按它调）。
// 内部用上游 `ClientWorkspaceModel` 做投影：baseline / upsert / remove / order / archived / pinned
// 的合并与快照缓存在那边已经写好，这里只负责**把流接上、把命令转发过去**——不重写一套状态机。
import {
  ClientWorkspaceModel,
  WorkspaceArchiveError,
  WorkspaceCreateError,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { WorkspaceController } from "./workspace-controller.contract.ts";
import { WorkspaceEndpointClient } from "./workspace-endpoint-client.ts";

/** 一条 follow 帧（上游 `WorkspaceFollowFrame` 的判别式联合）。 */
type FollowFrame =
  | {
      readonly type: "baseline";
      readonly value: Parameters<ClientWorkspaceModel["replaceBaseline"]>[0];
    }
  | {
      readonly type: "replace";
      readonly value: Parameters<ClientWorkspaceModel["replaceBaseline"]>[0];
    }
  | {
      readonly type: "upsert";
      readonly workspace: Parameters<ClientWorkspaceModel["upsertView"]>[0];
    }
  | {
      readonly type: "remove";
      readonly workspaceId: Parameters<ClientWorkspaceModel["removeView"]>[0];
    }
  | {
      readonly type: "order";
      readonly workspaceIds: Parameters<ClientWorkspaceModel["replaceOrder"]>[0];
    }
  | {
      readonly type: "archived";
      readonly archivedSessionIds: Parameters<ClientWorkspaceModel["replaceArchived"]>[0];
    }
  | {
      readonly type: "pinned";
      readonly pinnedSessionIds: Parameters<ClientWorkspaceModel["replacePinned"]>[0];
    };

@Injectable()
export class WorkspaceControllerDefault extends WorkspaceController implements OnInit, OnDispose {
  private readonly remote = inject(Remote);

  /** `workspace` 组的远端端点：模型的每个命令与那条 follow 流都走它。 */
  private readonly endpoint = inject(WorkspaceEndpointClient);

  /**
   * 数据面：`ClientWorkspaceModel` 的 `remote` 参数要一个**真实例**。
   *
   * 不能在字段初始化时造：那一刻 `inject` 的字段还是占位符（`resolvePending` 之后才换成真身），
   * 捕获进来就成了「每个命令都 `this.remote.create is not a function`」。所以推迟到 `onInit`。
   */
  private model: ClientWorkspaceModel | undefined;

  /** 工作区目录（`ui-workspace` 的 `useWorkspaces` 读它）：模型本身就是 `WorkspaceSource`。 */
  get list(): WorkspaceController["list"] {
    return this.modelOf();
  }

  /** 这条行自己的取消信号（follow 流跟着它一起收尾）。 */
  private readonly lifetime = new AbortController();

  /**
   * 接上 follow 流：首帧 baseline 决定 `phase`，之后的增量由模型自己合并。
   *
   * 宿主没挂 `workspace` 这一组时保持 `pending` 空态（不假装 ready）。
   */
  onInit(): void {
    // 契约的返回面写的是**两半共用的上界**（`Reply<T> = T | RemoteResultWire<T>`：宿主回裸值、客户端回
    // `Remote` 封装），而上游 `ClientWorkspaceModel` 只认客户端那一半——这里按它收窄一次。
    // 这一处是本仓唯一需要这个收窄的地方（契约类的方法面本身就是 `WorkspaceRemote` 的参数表）。
    this.model = new ClientWorkspaceModel(this.endpoint as unknown as ConstructorParameters<typeof ClientWorkspaceModel>[0]);
    void this.consume();
  }

  /** 数据面；`onInit` 之前访问是装配错误，直接说清楚。 */
  private modelOf(): ClientWorkspaceModel {
    if (this.model === undefined) throw new Error("[workspaces] 行还没 onInit：装配顺序错了");
    return this.model;
  }

  onDispose(): void {
    this.lifetime.abort(new Error("workspaces row disposed"));
  }

  private async consume(): Promise<void> {
    // 会话与工作区是两次独立的 `$mount`：必须按名字等，不能等「第一个 mount」。
    // 名字从契约的客户端形态取（组名的 home 在 `@RemoteGroup`）。
    await this.remote.whenNamespace(this.endpoint.name);
    try {
      for await (const frame of this.endpoint.follow(this.lifetime.signal)) this.accept(frame);
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      // 事实型观测：哪条流、什么错误；不写「工作区加载失败」这种总结。
      console.error("[workspaces] workspace/follow 结束于错误：", error);
    }
  }

  /** 把一帧 follow 结果交给模型。 */
  private accept(frame: FollowFrame): void {
    switch (frame.type) {
      case "baseline":
      case "replace":
        this.modelOf().replaceBaseline(frame.value);
        return;
      case "upsert":
        this.modelOf().upsertView(frame.workspace);
        return;
      case "remove":
        this.modelOf().removeView(frame.workspaceId);
        return;
      case "order":
        this.modelOf().replaceOrder(frame.workspaceIds);
        return;
      case "archived":
        this.modelOf().replaceArchived(frame.archivedSessionIds);
        return;
      case "pinned":
        this.modelOf().replacePinned(frame.pinnedSessionIds);
    }
  }

  async create(input: { path: string }): ReturnType<WorkspaceController["create"]> {
    const result = await this.modelOf().create(input);
    if (!result.ok) throw new WorkspaceCreateError(result.error);
    return result.value.workspace;
  }

  async initializeDefault(
    signal?: AbortSignal,
  ): ReturnType<WorkspaceController["initializeDefault"]> {
    const result = await this.modelOf().initializeDefault(signal);
    if (!result.ok) throw new WorkspaceCreateError(result.error);
    return result.value?.workspace;
  }

  async rename(
    workspaceId: Parameters<WorkspaceController["rename"]>[0],
    title: Parameters<WorkspaceController["rename"]>[1],
  ): ReturnType<WorkspaceController["rename"]> {
    const result = await this.modelOf().rename(workspaceId, title);
    if (!result.ok) throw commandError("rename", result.error);
    return result.value.workspace;
  }

  async delete(
    workspaceId: Parameters<WorkspaceController["delete"]>[0],
  ): ReturnType<WorkspaceController["delete"]> {
    const result = await this.modelOf().delete(workspaceId);
    if (!result.ok) throw commandError("delete", result.error);
  }

  async insertBefore(
    workspaceId: Parameters<WorkspaceController["insertBefore"]>[0],
    beforeWorkspaceId?: Parameters<WorkspaceController["insertBefore"]>[1],
  ): ReturnType<WorkspaceController["insertBefore"]> {
    const result = await this.modelOf().insertBefore(workspaceId, beforeWorkspaceId);
    if (!result.ok) throw commandError("reorder", result.error);
  }

  async archiveSession(
    sessionId: Parameters<WorkspaceController["archiveSession"]>[0],
    options?: Parameters<WorkspaceController["archiveSession"]>[1],
  ): ReturnType<WorkspaceController["archiveSession"]> {
    const result = await this.modelOf().archiveSession(sessionId, options);
    if (!result.ok) throw new WorkspaceArchiveError(result.error);
  }

  async unarchiveSession(
    sessionId: Parameters<WorkspaceController["unarchiveSession"]>[0],
  ): ReturnType<WorkspaceController["unarchiveSession"]> {
    const result = await this.modelOf().unarchiveSession(sessionId);
    if (!result.ok) throw commandError("session unarchive", result.error);
  }

  async pinSession(
    sessionId: Parameters<WorkspaceController["pinSession"]>[0],
  ): ReturnType<WorkspaceController["pinSession"]> {
    const result = await this.modelOf().pinSession(sessionId);
    if (!result.ok) throw commandError("session pin", result.error);
  }

  async unpinSession(
    sessionId: Parameters<WorkspaceController["unpinSession"]>[0],
  ): ReturnType<WorkspaceController["unpinSession"]> {
    const result = await this.modelOf().unpinSession(sessionId);
    if (!result.ok) throw commandError("session unpin", result.error);
  }

  async insertSessionBefore(
    workspaceId: Parameters<WorkspaceController["insertSessionBefore"]>[0],
    sessionId: Parameters<WorkspaceController["insertSessionBefore"]>[1],
    beforeSessionId?: Parameters<WorkspaceController["insertSessionBefore"]>[2],
  ): ReturnType<WorkspaceController["insertSessionBefore"]> {
    const result = await this.modelOf().insertSessionBefore(
      workspaceId,
      sessionId,
      beforeSessionId,
    );
    if (!result.ok) throw commandError("move", result.error);
    return result.value.workspace;
  }
}

/** 上游的失败面（`RemoteFailure`）转成人能读的错误。 */
function commandError(operation: string, failure: { code: string; message: string }): Error {
  return new Error(`workspace ${operation} failed: ${failure.code}: ${failure.message}`);
}
