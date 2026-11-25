// `WorkspaceFilesEndpoint` 的**客户端形态**：只消费、不实现。
//
// 六个方法都**显式转发**（不用 `@RemoteClient()` 的生成转发）：这里的 wire 是位置参数
// （`list(sessionId, path)`、`read(sessionId, path, range)` …），而生成转发的 unary 兜底是
// `invoke('<组>/<方法>', { request: 实参[0] })`——只包第一个实参，其余会丢。
//
// 挂载也归它自己（`onInit` 里 `$mount(remoteDescriptorsOf(WorkspaceFilesEndpoint))`）：右栏「文件夹」
// 标签与 `file` 资源 provider 都读 `remote.workspaceFiles`，那一面只有挂上 descriptor 之后才存在。
//
// `remote` 字段在这里显式声明：契约类不继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import type {
  WorkspaceByteReadOptions,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileSearchRequest,
  WorkspaceFileSearchResult,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from "@deepseek-ai/dsh-api-workspace-files";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { WorkspaceFilesEndpoint } from "@morlay/dsh-workspace/endpoint";

/** `workspaceFiles` 组的客户端契约实例。 */
@RemoteClient()
export class WorkspaceFilesEndpointClient extends WorkspaceFilesEndpoint implements OnInit {
  /** 转发目标：`remote.workspaceFiles`（`$mount` 之后的调用面）。 */
  protected readonly remote = inject(Remote);

  /**
   * 这一组的组名（wire 上的 `workspaceFiles`）：消费方拼 deps 键与按名字等挂载时用它，不手抄字符串。
   * @returns wire 上的组名。
   */
  get name(): string {
    return groupNameOf(this.constructor);
  }

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding / mount 行。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    try {
      const dispose = await this.remote.$mount(remoteDescriptorsOf(WorkspaceFilesEndpoint));
      ctx.effect(() => dispose);
    } catch (error) {
      throw new Error(`挂载 remote.${groupNameOf(WorkspaceFilesEndpoint)} 失败：${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  /**
   * 列一个目录：wire 是 `{ sessionId, path }`（位置实参按 `parameters` 映射成命名参数）。
   * @param sessionId - 会话身份。
   * @param path - 目标路径。
   * @returns 目录清单。
   */
  override async list(sessionId: SessionId, path: string): Promise<WorkspaceDirectoryListing> {
    return (await this.invoke("list", { sessionId, path })) as WorkspaceDirectoryListing;
  }

  /**
   * 读一段文本：wire 是 `{ sessionId, path, range }`。
   * @param sessionId - 会话身份。
   * @param path - 目标路径。
   * @param range - 行窗口。
   * @returns 这一页的文本。
   */
  override async read(
    sessionId: SessionId,
    path: string,
    range: WorkspaceFileRange,
  ): Promise<WorkspaceFileText> {
    return (await this.invoke("read", { sessionId, path, range })) as WorkspaceFileText;
  }

  /**
   * 读字节：wire 是 `{ sessionId, path, options }`。
   * @param sessionId - 会话身份。
   * @param path - 目标路径。
   * @param options - 字节窗口。
   * @returns 原生字节。
   */
  override async readBytes(
    sessionId: SessionId,
    path: string,
    options: WorkspaceByteReadOptions,
  ): Promise<WorkspaceFileBytes> {
    return (await this.invoke("readBytes", { sessionId, path, options })) as WorkspaceFileBytes;
  }

  /**
   * 文件元信息：wire 是 `{ sessionId, path }`。
   * @param sessionId - 会话身份。
   * @param path - 目标路径。
   * @returns 文件元信息。
   */
  override async stat(sessionId: SessionId, path: string): Promise<WorkspaceFileStat> {
    return (await this.invoke("stat", { sessionId, path })) as WorkspaceFileStat;
  }

  /**
   * 搜索：wire 是 `{ sessionId, request }`。
   * @param sessionId - 会话身份。
   * @param request - 查询与范围。
   * @returns 命中结果。
   */
  override async search(
    sessionId: SessionId,
    request: WorkspaceFileSearchRequest,
  ): Promise<WorkspaceFileSearchResult> {
    return (await this.invoke("search", { sessionId, request })) as WorkspaceFileSearchResult;
  }

  /**
   * 变更流：走 `$mount` 之后的 `remote.workspaceFiles` 面（流要有逐帧句柄，`invoke` 只回一个值）。
   * @param sessionId - 会话身份。
   * @param path - 目标路径。
   * @param signal - 取消信号。
   * @returns 逐帧的变更。
   */
  override changes(
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ): AsyncIterable<WorkspaceFileWatchFrame> {
    const face = remoteNamespaceOf(this.remote, this.name) as
      | { changes?: (sessionId: SessionId, path: string, signal: AbortSignal) => AsyncIterable<WorkspaceFileWatchFrame> }
      | undefined;
    const stream = face?.changes;
    if (stream === undefined) {
      throw new Error(`remote.${this.name} 还没有挂载：流式方法要等 $mount 之后才能调`);
    }
    return stream.call(face, sessionId, path, signal);
  }

  /**
   * 一次 unary 调用：端点名由组名（契约上的 `@RemoteGroup`）与方法名拼出，不另写字符串表。
   * @param method - 方法名。
   * @param args - wire 的命名参数。
   * @returns 宿主给的原样值。
   */
  private async invoke(method: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return await this.remote.invoke(`${this.name}/${method}`, args);
  }
}
