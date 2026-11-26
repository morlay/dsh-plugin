// `session` 组的**跨端契约**：组名、方法名，与每个端点的 wire 形参 / 应答类型。
//
// **类型全部取上游**（`@deepseek-ai/dsh-api-session-controller/types`）：wire 形状在那里定义，抄一遍只会
// 多一份会漂的声明（历史债：`SessionListValue` 曾写成 `{ ids, byId }`，上游是 `{ items }`）。
//
// **应答是裸值**：宿主是真相（上游 `SessionController` 的 `@Remote` 方法回裸值），`RemoteResult` 是
// 客户端面 `faceOf` 的包装，不进契约。
//
// **wire 形参名以宿主那一侧为准**（`@RemoteMethod({ parameters })`）：本组的宿主是上游控制器，
// 网关按**它**的 descriptor 校验参数——`list` 的形参名是 `_request`（整组里唯一带下划线的），
// 其余是 `request`；写错就是真机上的 `unexpected "request"` / `missing "_request"`。
import type {
  ModelCatalog,
  ModelSelection,
  PromptContentPart,
  QueueAction,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionEventFrame,
  SessionEventsPage,
  SessionObserveEventRequest,
  SessionProjectionFrame,
  SessionState,
  SessionStateRequest,
  SessionWaitRequest,
  SessionWaitValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPageRequest,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionWorkspacePathApplication,
} from "@deepseek-ai/dsh-api-session-controller/types";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam } from "@morlay/zephyr-app/typert";
import { RemoteGroup, RemoteMethod, groupNameOf } from "@morlay/zephyr-app/remote";
import type SessionControllerHost from "@deepseek-ai/dsh-api-session-controller";

// 上游同名的那些直接转出（消费方零改动）：wire 的请求 / 应答就是它们。
export type {
  ModelCatalog,
  ModelSelection,
  PromptContentPart,
  QueueAction,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionEventFrame,
  SessionEventsPage,
  SessionObserveEventRequest,
  SessionProjectionFrame,
  SessionState,
  SessionStateRequest,
  SessionWaitRequest,
  SessionWaitValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPageRequest,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionWorkspacePathApplication,
};

/** 模型目录的应答（上游 `ModelCatalog`；旧名保留给消费方）。 */
export type SessionModelCatalogValue = ModelCatalog;

/** 目录里的一行（上游 `SessionSummary`；旧名保留给消费方）。 */
export type SessionSummaryRow = SessionSummary;

/** `session/page` 的应答（上游 `SessionEventsPage`；旧名保留给消费方）。 */
export type SessionPageValue = SessionEventsPage;

/** `session/follow` 的首帧（上游 `SessionFollowFrame` 的 `snapshot` 分支）。 */
export type SessionFollowSnapshot = Extract<SessionFollowFrame, { readonly type: "snapshot" }>;

/** 一个模型选择（上游 `ModelSelection`）。 */
export type SessionModelSelection = ModelSelection;

/**
 * 组名（`session`）：唯一 home 是下面契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function sessionGroupName(): string {
  return groupNameOf(SessionEndpoint);
}
/** `session` 组：目录（建档 / 列表 / 翻页 / 跟随）、改名、选模型、分叉、搜索、投影与会话控制。 */
@RemoteGroup({ name: "session" })
export class SessionEndpoint {
  /**
   * 列出一条目录（上游 `{ items }`）。
   * @param _request - 预留的空请求（wire 名 `_request`：整组里唯一带下划线的形参）。
   * @returns 目录行。
   */
  @RemoteMethod({ parameters: ["_request"] })
  async list(_request: SessionListRequest): Promise<SessionListValue> {
    throw new Error("session/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 建一个会话（可复用已有的空白会话）。
   * @param _request - 位置、可复用身份与 agent preset。
   * @returns 会话身份。
   */
  @RemoteMethod({ parameters: ["request"] })
  async create(_request: SessionCreateRequest): Promise<SessionCreateValue> {
    throw new Error("session/create：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一页历史。
   * @param _request - 目标会话与续读位置。
   * @returns 这一页与是否还有更多。
   */
  @RemoteMethod({ parameters: ["request"] })
  async page(_request: SessionPageRequest): Promise<SessionEventsPage> {
    throw new Error("session/page：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 打开一个会话窗口：先给基线快照，之后逐帧推事件，直到取消。
   * @param _request - 目标会话。
   * @param _signal - 宿主侧的取消通道（载具注入，不是 wire 参数）。
   * @returns 基线快照与后续事件帧。
   */
  @RemoteMethod({ mode: "stream", parameters: ["request"] })
  follow(
    _request: SessionFollowRequest,
    _signal: AbortSignal,
  ): AsyncIterable<SessionFollowFrame> {
    throw new Error("session/follow：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * Host 级的投影状态流：一帧基线，之后逐条投影增量，直到取消。
   * @param _signal - 宿主侧的取消通道（载波注入，不是 wire 参数）。
   * @returns baseline 与后续增量帧。
   */
  @RemoteMethod({ mode: "stream", parameters: [] })
  control(_signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    throw new Error("session/control：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 改一个会话的标题。
   * @param _request - 会话与提议的标题。
   * @returns 被接受的标题与事件位置。
   */
  @RemoteMethod({ parameters: ["request"] })
  async rename(_request: SessionRenameRequest): Promise<SessionRenameValue> {
    throw new Error("session/rename：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 选模型。
   * @param _request - 会话与模型选择。
   * @returns 结算后的选择。
   */
  @RemoteMethod({ parameters: ["request"] })
  async selectModel(_request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    throw new Error("session/selectModel：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 从某个前缀分叉。
   * @param _request - 源会话与分叉位置。
   * @returns 子会话身份。
   */
  @RemoteMethod({ parameters: ["request"] })
  async fork(_request: SessionForkRequest): Promise<SessionForkValue> {
    throw new Error("session/fork：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 全文搜索。
   * @param _request - 查询。
   * @returns 命中与是否有更多。
   */
  @RemoteMethod({ parameters: ["request"] })
  async search(_request: SessionSearchRequest): Promise<SessionSearchValue> {
    throw new Error("session/search：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 模型目录。
   * @returns provider 分组与失败项。
   */
  @RemoteMethod({ parameters: [] })
  async modelCatalog(): Promise<ModelCatalog> {
    throw new Error("session/modelCatalog：契约类未实现（宿主侧要在子类里实现它）");
  }

  /** 初始化默认模型选择（首轮前调一次）。 */
  @RemoteMethod({ parameters: [] })
  async initializeDefaultModel(): Promise<void> {
    throw new Error("session/initializeDefaultModel：契约类未实现（宿主侧要在子类里实现它）");
  }

  /** 宿主能不能「在文件管理器里打开」某个工作区路径。 */
  @RemoteMethod({ parameters: [] })
  async canOpenWorkspacePath(): Promise<boolean> {
    throw new Error("session/canOpenWorkspacePath：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 给会话投递一段输入。
   * @param _request - 输入与投递模式。
   * @returns 受理回执。
   */
  @RemoteMethod({ parameters: ["request"] })
  async prompt(_request: SessionPromptRequest): Promise<SessionPromptValue> {
    throw new Error("session/prompt：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 取消当前这一轮。
   * @param _request - 目标会话。
   * @returns 受理回执。
   */
  @RemoteMethod({ parameters: ["request"] })
  async cancel(_request: SessionCancelRequest): Promise<SessionCancelValue> {
    throw new Error("session/cancel：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 改一条排队中的输入。
   * @param _request - 目标条目与动作。
   * @returns 受理回执。
   */
  @RemoteMethod({ parameters: ["request"] })
  async updateQueue(_request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    throw new Error("session/updateQueue：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 某个路径可用的「打开方式」列表。
   * @param _request - 目标路径。
   * @returns 应用列表。
   */
  @RemoteMethod({ parameters: ["request"] })
  async workspacePathApplications(
    _request: SessionOpenWorkspacePathRequest,
  ): Promise<readonly SessionWorkspacePathApplication[]> {
    throw new Error("session/workspacePathApplications：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一条会话里的图片附件。
   * @param _request - 会话与附件引用。
   * @returns 校验过的引用与数据。
   */
  @RemoteMethod({ parameters: ["request"] })
  async attachment(_request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    throw new Error("session/attachment：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一页事件（`session/page` 的旧别名）。
   * @param _request - 目标会话与位置。
   * @returns 这一页。
   */
  @RemoteMethod({ parameters: ["request"] })
  async events(_request: SessionPageRequest): Promise<SessionEventsPage> {
    throw new Error("session/events：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 在宿主的文件管理器里打开一个工作区路径。
   * @param _request - 路径与打开方式。
   * @returns 打开结果。
   */
  @RemoteMethod({ parameters: ["request"] })
  async openWorkspacePath(
    _request: SessionOpenWorkspacePathRequest,
  ): Promise<SessionOpenWorkspacePathValue> {
    throw new Error("session/openWorkspacePath：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一份投影快照。
   * @param _request - 会话与投影键。
   * @returns 投影值。
   */
  @RemoteMethod({ parameters: ["request"] })
  async projections(_request: SessionProjectionsRequest): Promise<SessionProjectionsValue> {
    throw new Error("session/projections：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 观察一个会话的事件流（上游 `SessionEventFrame`）。
   * @param _request - 目标会话地址。
   * @param _signal - 宿主侧的取消通道（载具注入，不是 wire 参数）。
   * @returns 逐帧的事件。
   */
  @RemoteMethod({ mode: "stream", parameters: ["request"] })
  observeEvent(
    _request: SessionObserveEventRequest,
    _signal: AbortSignal,
  ): AsyncIterable<SessionEventFrame> {
    throw new Error("session/observeEvent：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 观察一个会话的投影变化流。
   * @param _request - 目标会话地址。
   * @param _signal - 宿主侧的取消通道。
   * @returns 逐帧的投影变化。
   */
  @RemoteMethod({ mode: "stream", parameters: ["request"] })
  observeProjections(
    _request: SessionProjectionsRequest,
    _signal: AbortSignal,
  ): AsyncIterable<SessionProjectionFrame> {
    throw new Error("session/observeProjections：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一次会话状态（运行中 / 队列 / 待处理输入）。
   * @param _request - 目标会话地址。
   * @returns 这一拍的状态。
   */
  @RemoteMethod({ parameters: ["request"] })
  async state(_request: SessionStateRequest): Promise<SessionState> {
    throw new Error("session/state：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 观察会话状态的帧流。
   * @param _request - 目标会话地址。
   * @param _signal - 宿主侧的取消通道。
   * @returns 逐帧的状态。
   */
  @RemoteMethod({ mode: "stream", parameters: ["request"] })
  observeState(
    _request: SessionStateRequest,
    _signal: AbortSignal,
  ): AsyncIterable<SessionState> {
    throw new Error("session/observeState：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 等这一轮结算（上游 `SessionWaitValue`）。
   * @param _request - 目标会话与等待条件。
   * @returns 等待结果。
   */
  @RemoteMethod({ parameters: ["request"] })
  async wait(_request: SessionWaitRequest): Promise<SessionWaitValue> {
    throw new Error("session/wait：契约类未实现（宿主侧要在子类里实现它）");
  }}
/** 本组覆盖的 **unary** 端点（显式列出：按 `keyof` 取会放过「契约掉了一个端点」）。 */
type UnaryEndpoints =
  | "list"
  | "create"
  | "page"
  | "rename"
  | "selectModel"
  | "fork"
  | "search"
  | "modelCatalog"
  | "initializeDefaultModel"
  | "canOpenWorkspacePath"
  | "prompt"
  | "cancel"
  | "updateQueue"
  | "workspacePathApplications"
  | "attachment"
  | "events"
  | "openWorkspacePath"
  | "projections"
  | "state"
  | "wait";

/** 本组覆盖的**流式**端点。 */
type StreamEndpoints = "follow" | "control" | "observeEvent" | "observeProjections" | "observeState";

/**
 * 上游 `session` 的 **wire 面**：宿主类 `SessionController` 的三步投影（规则与出处见
 * `@morlay/zephyr-app/typert` 的 `params.ts`）：去末尾 `signal`（走 cancellation）→ `AsyncReturn`
 * （unary 异步化；`AsyncIterable` 不包 `Promise`）。本组没有 lookup 形参（`sessionId` 在请求体里）。
 */
type SessionWire = AsyncReturn<DropParam<SessionControllerHost, AbortSignal>>;

/**
 * 覆盖守卫（unary）：契约对上宿主类的 wire 面（形参与返回**双向**，见 `AssertWireFace`）。
 */
export type SessionEndpointCovered = AssertTrue<
  AssertWireFace<Pick<SessionWire, UnaryEndpoints>, Pick<SessionEndpoint, UnaryEndpoints>>
>;

/**
 * 覆盖守卫（流式）：**契约侧也要把末尾那个取消信号摘掉再比**——那个 `signal` 是宿主侧的取消通道
 * （载具注入，`registerRemoteGroup` 按 `handler.length >= 2` 传），不是 wire 参数；宿主类的原文同样带它。
 * 这套做法在 `workspaceFiles` 的 `changes` 上验过。
 */
export type SessionEndpointStreamCovered = AssertTrue<
  AssertWireFace<
    Pick<SessionWire, StreamEndpoints>,
    Pick<DropParam<SessionEndpoint, AbortSignal>, StreamEndpoints>
  >
>;