// 宿主侧 `remote.workspace` 的提供者。
//
// **流程（谁在什么时候产出什么）**：
//   1. 页面挂载 → `WorkspaceRegistryDefault` 打开 `workspace/follow` → 这里先发一帧 `baseline`
//      （`registry.list()` + 归档/置顶集合），客户端据此渲染工作区行；
//   2. 用户改工作区 → `workspace/<command>`（unary）→ 上游 `WorkspaceController` 落 registry（持久化）→
//      这里把命令结果折成一帧增量（upsert / remove / order / archived / pinned）广播给所有活跃的 follow 流；
//   3. 用户选目录 → `directoryPicker/pick` → 客户端拿到路径 → `workspace/create` → 回到第 2 步。
//
// **为什么不用上游 `WorkspaceController.follow`**：它靠 `WorkspaceFeed` 订阅 `domain/changed` 事件，而
// `StorageDomain` 与这一行是两个独立作用域——cordis 事件不跨兄弟作用域传播，feed 永远收不到写事件，
// follow 流只会有 baseline（页面表现就是「建了工作区，列表不出现」）。所以增量由**命令的返回值**驱动：
// 命令本来就知道自己改了什么，这里只把它折成帧广播出去，不依赖事件总线。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`，见 `endpoint/workspace.group.ts`）：
// 这里只写业务转发与帧广播，wire 上叫什么不在本文件里出现。
import { WorkspaceCommands } from "@deepseek-ai/dsh-api-workspace-controller/src/commands.ts";
import { defaultWorkspaceDirectory } from "@deepseek-ai/dsh-api-workspace-controller/src/default-directory.ts";
import { workspaceView } from "@deepseek-ai/dsh-api-workspace-controller/src/feed.ts";
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspacePinSessionRequest,
  WorkspacePinValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceUnpinSessionRequest,
  WorkspaceValue,
} from "@deepseek-ai/dsh-api-workspace-controller/types";
import { inject, Injectable, type Context, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { WorkspaceRegistry } from "../contract/workspace.contract.ts";
import { WorkspaceEndpoint } from "../endpoint/index.ts";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";

/**
 * 上游 `WorkspaceCommands` **真有的**成员（wire 要转发的 unary 命令）。
 *
 * 面按上游成员表 `Pick`，不另抄签名；面里没有的不出现在这里——上游没有的命令由本行自己实现
 * （`initializeDefault`，见 {@link WorkspaceControllerRow.initializeDefault}），不冒充上游。
 */
type WorkspaceCommandsFace = Pick<
  WorkspaceCommands,
  | "create"
  | "rename"
  | "delete"
  | "insertBefore"
  | "insertSessionBefore"
  | "archiveSession"
  | "unarchiveSession"
  | "pinSession"
  | "unpinSession"
>;

/** `workspace` 组的宿主实现：`@RemoteGroup()` 不写名字——组名从契约类继承。 */
@RemoteGroup()
@Injectable()
export class WorkspaceControllerRow extends WorkspaceEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  private readonly workspaceRegistry = inject(WorkspaceRegistry);

  private readonly disposers: (() => void)[] = [];

  private readonly broadcaster = inject(WorkspaceBroadcaster);

  /** 上游命令面；`onInit` 之前访问是装配错误（方法只在注册之后才可能被 wire 调到）。 */
  private commandsRow: WorkspaceCommandsFace | undefined;

  onInit(ctx: Context): void {
    // **不用上游 `Workspace控制器` 那一行**：它的构造函数里 `ctx.plugin(DirectoryPickerController)`，
    // 那是「在 apply 里建子插件」的隐含注册（服务名与生命周期都由它自己决定），我们的作用域一律报错。
    // 目录选择已经在 `DirectoryPickerControllerRow`（装上游）+ `DirectoryPickerEndpointRow`（接 wire）
    // 里显式装配，`directoryPicker/*` 由后者的契约注册。
    //
    // 命令逻辑直接复用上游的 `WorkspaceCommands`：它只读 `ctx.workspaceRegistry`，不碰 cordis 的插件装载。
    // 命令的请求形状就是上游的形状（含 `WorkspaceId` / `SessionId` 品牌）：wire 上的裸字符串由客户端
    // 生成面在调用时铸成品牌，这里一路是品牌类型。
    this.commandsRow = new WorkspaceCommands(
      ctx.extend({ workspaceRegistry: this.workspaceRegistry }),
    );
    // unary 的结果都是**裸值**（客户端 `remote.workspace` 面自己按 `result.ok` 解）；`follow` 是流，
    // 帧本身即业务值。
    this.disposers.push(registerRemoteGroup(this.handlers, this));
  }

  override async create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    const value = await this.commands().create(request);
    this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
    return value;
  }

  override async rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const value = await this.commands().rename(request);
    this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
    return value;
  }

  override async delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    const value = await this.commands().delete(request);
    this.broadcaster.broadcast({ type: "remove", workspaceId: request.workspaceId });
    return value;
  }

  override async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    const value = await this.commands().insertBefore(request);
    this.broadcaster.broadcast({ type: "order", workspaceIds: value.workspaceIds });
    return value;
  }

  override async insertSessionBefore(
    request: WorkspaceInsertSessionBeforeRequest,
  ): Promise<WorkspaceValue> {
    const value = await this.commands().insertSessionBefore(request);
    this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
    return value;
  }

  override async archiveSession(
    request: WorkspaceArchiveSessionRequest,
  ): Promise<WorkspaceArchiveValue> {
    const value = await this.commands().archiveSession(request);
    this.broadcaster.broadcast({
      type: "archived",
      archivedSessionIds: value.archivedSessionIds,
    });
    return value;
  }

  override async unarchiveSession(
    request: WorkspaceUnarchiveSessionRequest,
  ): Promise<WorkspaceArchiveValue> {
    const value = await this.commands().unarchiveSession(request);
    this.broadcaster.broadcast({
      type: "archived",
      archivedSessionIds: value.archivedSessionIds,
    });
    return value;
  }

  override async pinSession(request: WorkspacePinSessionRequest): Promise<WorkspacePinValue> {
    const value = await this.commands().pinSession(request);
    this.broadcaster.broadcast({ type: "pinned", pinnedSessionIds: value.pinnedSessionIds });
    return value;
  }

  override async unpinSession(request: WorkspaceUnpinSessionRequest): Promise<WorkspacePinValue> {
    const value = await this.commands().unpinSession(request);
    this.broadcaster.broadcast({ type: "pinned", pinnedSessionIds: value.pinnedSessionIds });
    return value;
  }

  /**
   * 首次使用的工作区（`workspace/initializeDefault`）。
   *
   * 上游把这一条放在 `WorkspaceController` 上（`WorkspaceCommands` 只做「已存在目录上的命令」），
   * 而那一行的构造会 `ctx.plugin(DirectoryPickerController)`——见 `onInit` 的注释，我们不装它。
   * 所以这一条由本行实现，语义与上游一致：
   * 目录策略是系统 Documents 目录（`defaultWorkspaceDirectory(undefined, signal)`），**建不建**由注册表判定
   * （已有工作区 / 已有会话 / 已有落盘会话头时返回 `undefined`，不造默认工作区）。
   * @param _signal - 契约的形参对齐上游 descriptor（`cancellation.parameter`）；unary 的 wire 不带信号，
   * `registerRemoteGroup` 传进来的是**空的 args**，所以这里另给一个不会 abort 的 controller。
   * @returns 新工作区的投影，或「首次初始化不适用」时的 `undefined`。
   */
  override async initializeDefault(_signal?: AbortSignal): Promise<WorkspaceValue | undefined> {
    const value = await this.initializeDefaultOf(new AbortController().signal);
    if (value !== undefined) {
      this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
    }
    return value;
  }

  override follow(signal?: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    // 形参只留取消信号（流式方法的第二种签名）：`registerRemoteGroup` 按实参个数分派，
    // 一个形参意味着「wire 上没有请求，只有生命周期」。
    return this.broadcaster.follow(signal ?? new AbortController().signal);
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  /** 上游命令面；没 `onInit` 就被调到是装配错误，直接说清楚。 */
  private commands(): WorkspaceCommandsFace {
    if (this.commandsRow === undefined) {
      throw new Error("[workspace] 命令行还没 onInit：装配顺序错了");
    }
    return this.commandsRow;
  }

  /**
   * `initializeDefault` 的业务体（与上游 `WorkspaceController` 同一条判定）。
   * @param signal - 调用方生命周期；取消会中止目录解析。
   * @returns 新工作区的投影，或「首次初始化不适用」时的 `undefined`。
   */
  private async initializeDefaultOf(signal: AbortSignal): Promise<WorkspaceValue | undefined> {
    const workspace = await this.workspaceRegistry.initializeDefault(() =>
      defaultWorkspaceDirectory(undefined, signal),
    );
    return workspace === undefined ? undefined : { workspace: workspaceView(workspace) };
  }
}
