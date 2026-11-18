// `workspaceFiles` 组的**两端共用面**：组名、deps 键、方法名与每个方法的请求/应答形状
// （与上游 `api/workspace-files` 的描述符一致）。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧
// （`server/workspace-files-endpoint.service.ts`）继承它实现方法。客户端形态不在本仓：这一组的
// 客户端面由上游 `@deepseek-ai/dsh-api-workspace-files#workspaceFiles` 的 `$mount` 面提供。
//
// 类型从上游包取（`import type`，运行期零边）：请求/应答的 wire 形状本来就在那里定义，
// 抄一遍只会多一份会漂的声明。
import type {
  WorkspaceByteReadOptions,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from "@deepseek-ai/dsh-api-workspace-files";
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/** 组在 `Remote` 面上的 deps 键（`remote.workspaceFiles`）。 */
export const WORKSPACE_FILES_REMOTE_KEY = "remote.workspaceFiles" as const;

/**
 * 作用域参数：会话身份。
 *
 * 上游 descriptor 的 `name: workspaceFileScope` / `wire: workspaceFileScopeId` 是两个不同的键，
 * 我们的客户端按 `name` 发、上游生成面按 `wire` 发，旧客户端还发过 `sessionId`——三个都认，
 * 免得换客户端就崩（口径见 `server/workspace-files-endpoint.service.ts` 的 `scopeOf`）。
 */
export interface WorkspaceFilesScopeRequest {
  /** 上游生成面发的 wire 名。 */
  readonly workspaceFileScopeId?: string;
  /** 本地客户端按 descriptor 的 `name` 发出来的那份。 */
  readonly workspaceFileScope?: string;
  /** 会话身份的直白名（早期客户端）。 */
  readonly sessionId?: string;
}

/** 一个路径操作的请求（列 / 读 / 读字节 / stat 共用作用域 + 路径）。 */
export interface WorkspaceFilesPathRequest extends WorkspaceFilesScopeRequest {
  /** 目标路径：绝对路径或 workspace 相对路径；省略即 workspace 根。 */
  readonly path?: string;
}

/** `workspaceFiles/read` 的请求：多一个行窗口。 */
export interface WorkspaceFilesReadRequest extends WorkspaceFilesPathRequest {
  /** 行窗口；省略字段取上游的默认分页。 */
  readonly range?: WorkspaceFileRange;
}

/** `workspaceFiles/readBytes` 的请求：多一个字节窗口。 */
export interface WorkspaceFilesReadBytesRequest extends WorkspaceFilesPathRequest {
  /** 字节窗口与基准文件；省略即整文件（受上游上限约束）。 */
  readonly options?: WorkspaceByteReadOptions;
}

/**
 * `workspaceFiles` 组：读 / 列 / 观察工作区里的文件。
 *
 * 应答是**裸值**（与上游 `@Remote` 同协议，失败即异常，不包 `{ ok, value }`）；流式那条的帧也不包
 * `RemoteResult`（客户端按帧解，与 `workspace/follow` 同口径）。
 */
@RemoteGroup({ name: "workspaceFiles" })
export class WorkspaceFilesEndpoint {
  /**
   * 列一个目录。
   * @param _request - 会话作用域与路径。
   * @returns 目录清单（条目 + 是否截断）。
   */
  @RemoteMethod()
  async list(_request: WorkspaceFilesPathRequest): Promise<WorkspaceDirectoryListing> {
    throw new Error("workspaceFiles/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一段文本（按行窗口）。
   * @param _request - 会话作用域、路径与行窗口。
   * @returns 这一页的文本与「是不是读到最后一行」。
   */
  @RemoteMethod()
  async read(_request: WorkspaceFilesReadRequest): Promise<WorkspaceFileText> {
    throw new Error("workspaceFiles/read：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读字节（不按文本解码）。
   * @param _request - 会话作用域、路径与字节窗口。
   * @returns 原生字节与读取窗口的终点。
   */
  @RemoteMethod()
  async readBytes(_request: WorkspaceFilesReadBytesRequest): Promise<WorkspaceFileBytes> {
    throw new Error("workspaceFiles/readBytes：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 报告一个文件的身份、版本与大小（不读内容）。
   * @param _request - 会话作用域与路径。
   * @returns 文件元信息。
   */
  @RemoteMethod()
  async stat(_request: WorkspaceFilesPathRequest): Promise<WorkspaceFileStat> {
    throw new Error("workspaceFiles/stat：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 观察一个目录（或 workspace 根）的变更。
   * @param _request - 会话作用域与路径。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧的变更。
   */
  @RemoteMethod({ mode: "stream" })
  changes(
    _request: WorkspaceFilesPathRequest,
    _signal: AbortSignal,
  ): AsyncIterable<WorkspaceFileWatchFrame> {
    throw new Error("workspaceFiles/changes：契约类未实现（宿主侧要在子类里实现它）");
  }
}
