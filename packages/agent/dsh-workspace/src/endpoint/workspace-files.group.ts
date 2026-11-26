// `workspaceFiles` 组的**两端共用面**：组名、deps 键、方法名与每个方法的请求/应答形状
// （与上游 `api/workspace-files` 的描述符一致）。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧
// （`server/workspace-files-endpoint.service.ts`）继承它实现方法；浏览器侧的客户端形态是
// `ui/workspace-files-endpoint.client.ts`（挂载在它的 `onInit` 里）。
//
// 类型从上游包取（`import type`，运行期零边）：请求/应答的 wire 形状本来就在那里定义，
// 抄一遍只会多一份会漂的声明。
import type {
  WorkspaceByteReadOptions,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileScope,
  WorkspaceFileSearchRequest,
  WorkspaceFileSearchResult,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from "@deepseek-ai/dsh-api-workspace-files";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam, MapParam } from "@morlay/zephyr-app/typert";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { groupNameOf, RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type WorkspaceFilesHost from "@deepseek-ai/dsh-api-workspace-files";

/**
 * 组名（`workspaceFiles`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function workspaceFilesGroupName(): string {
  return groupNameOf(WorkspaceFilesEndpoint);
}

/**
 * `workspaceFiles` 组：读 / 列 / 搜索 / 观察工作区里的文件。
 *
 * **形参就是上游协议的形参**（位置参数）：上游消费方（`ui-sidebar-files` 等）按
 * `remote.workspaceFiles.list(sessionId, path, signal)` 调，descriptor 的第一个形参是 lookup
 * （wire 传 id、网关解析成 `WorkspaceFileScope`）。曾经这里是一个 `{ request }` 对象，于是那些调用
 * 全部落到"宿主只收到一个字符串"——与 `commands/execute` 同一类事故。
 *
 * 应答是**裸值**（与上游 `@Remote` 同协议，失败即异常，不包 `{ ok, value }`）。
 */
@RemoteGroup({ name: "workspaceFiles" })
export class WorkspaceFilesEndpoint {
  /**
   * 列一个目录。
   * @param _sessionId - 会话身份（wire 上是 lookup id，上游称 `workspaceFileScopeId`）。
   * @param _path - 目标路径（绝对或 workspace 相对；空串＝workspace 根）。
   * @returns 目录清单（条目 + 是否截断）。
   */
  @RemoteMethod({ parameters: ["sessionId", "path"] })
  async list(_sessionId: SessionId, _path: string): Promise<WorkspaceDirectoryListing> {
    throw new Error("workspaceFiles/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一段文本（按行窗口）。
   * @param _sessionId - 会话身份。
   * @param _path - 目标路径。
   * @param _range - 行窗口（空对象＝上游默认分页）。
   * @returns 这一页的文本与「是不是读到最后一行」。
   */
  @RemoteMethod({ parameters: ["sessionId", "path", "range"] })
  async read(
    _sessionId: SessionId,
    _path: string,
    _range: WorkspaceFileRange,
  ): Promise<WorkspaceFileText> {
    throw new Error("workspaceFiles/read：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读字节（不按文本解码）。
   * @param _sessionId - 会话身份。
   * @param _path - 目标路径。
   * @param _options - 字节窗口与基准文件（空对象＝整文件）。
   * @returns 原生字节与读取窗口的终点。
   */
  @RemoteMethod({ parameters: ["sessionId", "path", "options"] })
  async readBytes(
    _sessionId: SessionId,
    _path: string,
    _options: WorkspaceByteReadOptions,
  ): Promise<WorkspaceFileBytes> {
    throw new Error("workspaceFiles/readBytes：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 报告一个文件的身份、版本与大小（不读内容）。
   * @param _sessionId - 会话身份。
   * @param _path - 目标路径。
   * @returns 文件元信息。
   */
  @RemoteMethod({ parameters: ["sessionId", "path"] })
  async stat(_sessionId: SessionId, _path: string): Promise<WorkspaceFileStat> {
    throw new Error("workspaceFiles/stat：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 在工作区里搜索文件名/内容（上游 `WorkspaceFiles.search`）。
   * @param _sessionId - 会话身份。
   * @param _request - 查询与范围。
   * @returns 命中结果。
   */
  @RemoteMethod({ parameters: ["sessionId", "request"] })
  async search(
    _sessionId: SessionId,
    _request: WorkspaceFileSearchRequest,
  ): Promise<WorkspaceFileSearchResult> {
    throw new Error("workspaceFiles/search：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 观察一个目录（或 workspace 根）的变更。
   * @param _sessionId - 会话身份。
   * @param _path - 目标路径。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧的变更。
   */
  @RemoteMethod({ mode: "stream", parameters: ["sessionId", "path"] })
  changes(
    _sessionId: SessionId,
    _path: string,
    _signal: AbortSignal,
  ): AsyncIterable<WorkspaceFileWatchFrame> {
    throw new Error("workspaceFiles/changes：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * **上游 `workspaceFiles` 的 wire 面**：宿主类 `WorkspaceFiles` 的三步投影（规则与出处见
 * `@morlay/zephyr-app/typert` 的 `params.ts`）：去末尾 `signal` → lookup 把 `WorkspaceFileScope`
 * 换成 wire 上的 id → 异步化。
 */
type WorkspaceFilesWire = AsyncReturn<
  MapParam<DropParam<WorkspaceFilesHost, AbortSignal>, WorkspaceFileScope, SessionId>
>;

/**
 * 覆盖守卫：契约对上**宿主类**的 wire 面（形参与返回双向，见 `AssertWireFace`）。
 *
 * 覆盖范围显式列出（不按 `keyof` 取：那会放过「契约掉了一个端点」）。
 */
export type WorkspaceFilesEndpointCovered = AssertTrue<
  AssertWireFace<
    Pick<WorkspaceFilesWire, "list" | "read" | "readBytes" | "stat" | "search">,
    WorkspaceFilesEndpoint
  >
>;

/**
 * 流式端点单独比：**契约侧也要把末尾那个取消信号摘掉再比**。
 *
 * 我们的契约方法写成 `changes(sessionId, path, signal)`——那个 signal 是**宿主侧**的取消通道
 * （载具注入：`registerRemoteGroup` 按 `handler.length >= 2` 传），**不是 wire 参数**；宿主类的原文
 * 同样带它，而 wire 面没有它。所以两侧各摘一次，剩下的形参与返回直接可比
 * （`AsyncReturn` 对 `AsyncIterable` 不做 `Promise` 包装）。
 */
export type WorkspaceFilesStreamCovered = AssertTrue<
  AssertWireFace<
    Pick<WorkspaceFilesWire, "changes">,
    Pick<DropParam<WorkspaceFilesEndpoint, AbortSignal>, "changes">
  >
>;
