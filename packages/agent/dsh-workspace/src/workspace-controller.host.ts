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
// 上游的 `@Remote` 装饰只是生成 descriptor；wire 由我们的 `MuxServer` 独占，所以每条命令都要显式注册。
import { WorkspaceCommands } from "@deepseek-ai/dsh-api-workspace-controller/src/commands.ts";
import { defaultWorkspaceDirectory } from "@deepseek-ai/dsh-api-workspace-controller/src/default-directory.ts";
import { workspaceView } from "@deepseek-ai/dsh-api-workspace-controller/src/feed.ts";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type Context, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { WorkspaceRegistry } from "./contract/workspace.contract.ts";
import { asRemoteResult } from "@morlay/zephyr-app";
import { WorkspaceBroadcaster } from "./workspace-broadcaster.service.ts";

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

/** 上游 `WorkspaceView` 的字段（帧里原样转发）。 */
interface WorkspaceViewWire {
  readonly workspaceId: string;
}

@Injectable()
export class WorkspaceControllerRow implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  private readonly workspaceRegistry = inject(WorkspaceRegistry);

  private readonly disposers: (() => void)[] = [];

  private readonly broadcaster = inject(WorkspaceBroadcaster);

  onInit(ctx: Context): void {
    // **不用上游 `Workspace控制器` 那一行**：它的构造函数里 `ctx.plugin(DirectoryPickerController)`，
    // 那是「在 apply 里建子插件」的隐含注册（服务名与生命周期都由它自己决定），我们的作用域一律报错。
    // 目录选择已经在 `DirectoryPickerControllerRow` 里显式装配，wire 上的 `directoryPicker/*` 由它注册。
    //
    // 命令逻辑直接复用上游的 `WorkspaceCommands`：它只读 `ctx.workspaceRegistry`，不碰 cordis 的插件装载。
    // 命令的请求形状就是上游的形状（含 `WorkspaceId` / `SessionId` 品牌）：wire 上的裸字符串在下面每个
    // 调用点铸一次，之后一路是品牌类型。
    const host: WorkspaceCommandsFace = new WorkspaceCommands(
      ctx.extend({ workspaceRegistry: this.workspaceRegistry }),
    );
    // unary 的结果都包成 `RemoteResult`（上游 client 面按 `result.ok` 解）；`follow` 是流，帧本身即业务值。
    this.disposers.push(
      this.handlers.registerStream("workspace/follow", (_args, signal) => this.broadcaster.follow(signal)),
      this.handlers.register("workspace/create", async (args) =>
        asRemoteResult(async () => {
          const value = await host.create(args.request as { path: string });
          this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
          return value;
        }),
      ),
      this.handlers.register("workspace/rename", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { workspaceId: string; title: string };
          const value = await host.rename({ workspaceId: WorkspaceId(request.workspaceId), title: request.title });
          this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
          return value;
        }),
      ),
      this.handlers.register("workspace/delete", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { workspaceId: string };
          const value = await host.delete({ workspaceId: WorkspaceId(request.workspaceId) });
          this.broadcaster.broadcast({ type: "remove", workspaceId: request.workspaceId });
          return value;
        }),
      ),
      this.handlers.register("workspace/insertBefore", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { workspaceId: string; beforeWorkspaceId?: string };
          const value = await host.insertBefore({
            workspaceId: WorkspaceId(request.workspaceId),
            ...(request.beforeWorkspaceId === undefined
              ? {}
              : { beforeWorkspaceId: WorkspaceId(request.beforeWorkspaceId) }),
          });
          this.broadcaster.broadcast({ type: "order", workspaceIds: value.workspaceIds });
          return value;
        }),
      ),
      this.handlers.register("workspace/insertSessionBefore", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as {
            workspaceId: string;
            sessionId: string;
            beforeSessionId?: string;
          };
          const value = await host.insertSessionBefore({
            workspaceId: WorkspaceId(request.workspaceId),
            sessionId: SessionId(request.sessionId),
            ...(request.beforeSessionId === undefined
              ? {}
              : { beforeSessionId: SessionId(request.beforeSessionId) }),
          });
          this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
          return value;
        }),
      ),
      this.handlers.register("workspace/archiveSession", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { sessionId: string; stopActivity?: boolean };
          const value = await host.archiveSession({
            sessionId: SessionId(request.sessionId),
            ...(request.stopActivity === undefined ? {} : { stopActivity: request.stopActivity }),
          });
          this.broadcaster.broadcast({ type: "archived", archivedSessionIds: value.archivedSessionIds });
          return value;
        }),
      ),
      this.handlers.register("workspace/unarchiveSession", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { sessionId: string };
          const value = await host.unarchiveSession({ sessionId: SessionId(request.sessionId) });
          this.broadcaster.broadcast({ type: "archived", archivedSessionIds: value.archivedSessionIds });
          return value;
        }),
      ),
      this.handlers.register("workspace/pinSession", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { sessionId: string };
          const value = await host.pinSession({ sessionId: SessionId(request.sessionId) });
          this.broadcaster.broadcast({ type: "pinned", pinnedSessionIds: value.pinnedSessionIds });
          return value;
        }),
      ),
      this.handlers.register("workspace/unpinSession", async (args) =>
        asRemoteResult(async () => {
          const request = args.request as { sessionId: string };
          const value = await host.unpinSession({ sessionId: SessionId(request.sessionId) });
          this.broadcaster.broadcast({ type: "pinned", pinnedSessionIds: value.pinnedSessionIds });
          return value;
        }),
      ),
      // unary 的 wire 不带信号：上游签名要一个 `AbortSignal`（它会与超时合成），这里给一次性的。
      this.handlers.register("workspace/initializeDefault", async () =>
        asRemoteResult(async () => {
          const value = await this.initializeDefault(new AbortController().signal);
          if (value !== undefined) this.broadcaster.broadcast({ type: "upsert", workspace: value.workspace });
          return value;
        }),
      ),
    );
  }

  /**
   * 首次使用的工作区（`workspace/initializeDefault`）。
   *
   * 上游把这一条放在 `WorkspaceController` 上（`WorkspaceCommands` 只做「已存在目录上的命令」），
   * 而那一行的构造会 `ctx.plugin(DirectoryPickerController)`——见 `onInit` 的注释，我们不装它。
   * 所以这一条由本行实现，语义与上游一致：
   * 目录策略是系统 Documents 目录（`defaultWorkspaceDirectory(undefined, signal)`），**建不建**由注册表判定
   * （已有工作区 / 已有会话 / 已有落盘会话头时返回 `undefined`，不造默认工作区）。
   * @param signal - 调用方生命周期；取消会中止目录解析。
   * @returns 新工作区的投影，或「首次初始化不适用」时的 `undefined`。
   */
  private async initializeDefault(signal: AbortSignal): Promise<{ workspace: WorkspaceViewWire } | undefined> {
    const workspace = await this.workspaceRegistry.initializeDefault(() =>
      defaultWorkspaceDirectory(undefined, signal),
    );
    return workspace === undefined ? undefined : { workspace: workspaceView(workspace) };
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
