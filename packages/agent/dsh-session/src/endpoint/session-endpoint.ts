// `session` 这一组的**跨端契约**：组名、组内每个方法的名字与请求/响应形状。
//
// 两端共用同一份声明：宿主侧实现它（`server/`），浏览器侧按它消费（`ui/` 的 `@RemoteClient()`）。
// 契约是普通类：客户端形态与宿主形态各自继承它。
// **它不继承 `RemoteClientBase`**：那个基类带一个 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务。
//
// 形状照上游 descriptor 抄（`namespace: 'session'`），但**声明在我们这里**：`endpoint/` 是两端共用的面，
// 引宿主包（`@deepseek-ai/*`）会把宿主半拖进浏览器打包图。字段一个不少，名字归我们。
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/remote";

/** wire 上的端点名（与上游 descriptor 一致）。 */
export const SESSION_RENAME_ENDPOINT = "session/rename";
/** wire 上的端点名。 */
export const SESSION_SELECT_MODEL_ENDPOINT = "session/selectModel";
/** wire 上的端点名。 */
export const SESSION_FORK_ENDPOINT = "session/fork";
/** wire 上的端点名。 */
export const SESSION_SEARCH_ENDPOINT = "session/search";
/** wire 上的端点名。 */
export const SESSION_MODEL_CATALOG_ENDPOINT = "session/modelCatalog";
/** wire 上的端点名。 */
export const SESSION_INITIALIZE_DEFAULT_MODEL_ENDPOINT = "session/initializeDefaultModel";
/** wire 上的端点名。 */
export const SESSION_CAN_OPEN_WORKSPACE_PATH_ENDPOINT = "session/canOpenWorkspacePath";
/** wire 上的端点名。 */
export const SESSION_WORKSPACE_PATH_APPLICATIONS_ENDPOINT = "session/workspacePathApplications";
/** wire 上的端点名。 */
export const SESSION_PROMPT_ENDPOINT = "session/prompt";
/** wire 上的端点名。 */
export const SESSION_CANCEL_ENDPOINT = "session/cancel";
/** wire 上的端点名。 */
export const SESSION_UPDATE_QUEUE_ENDPOINT = "session/updateQueue";
/** wire 上的端点名。 */
export const SESSION_LIST_ENDPOINT = "session/list";
/** wire 上的端点名。 */
export const SESSION_CREATE_ENDPOINT = "session/create";
/** wire 上的端点名。 */
export const SESSION_PAGE_ENDPOINT = "session/page";
/** wire 上的端点名。 */
export const SESSION_FOLLOW_ENDPOINT = "session/follow";

/** 一个模型选择（上游 `ModelSelection`）。 */
export interface SessionModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** 一个可选的推理档位（上游 `ModelReasoningEffort`）。 */
export interface SessionModelReasoningEffort {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/** 一个模型的可选推理档位集合（上游 `ModelReasoning`）。 */
export interface SessionModelReasoning {
  readonly efforts: readonly SessionModelReasoningEffort[];
  readonly defaultEffort?: string;
}

/** provider 给的短标签（上游 `LlmModelBadge`）：字面量或按语言 id 的译文表。 */
export interface SessionModelBadge {
  readonly text: string | Readonly<Record<string, string>>;
  readonly tone: "neutral" | "info" | "success" | "warning";
}

/** 目录里的一条模型（上游 `ModelCatalogModel`）。 */
export interface SessionModelCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly reasoning?: SessionModelReasoning;
  readonly badge?: SessionModelBadge;
}

/** 一个 provider 与它成功加载的模型（上游 `ModelProviderGroup`）。 */
export interface SessionModelProviderGroup {
  readonly id: string;
  readonly name: string;
  readonly models: readonly SessionModelCatalogModel[];
}

/** 一个目录查询失败的 provider（上游 `ModelCatalogFailure`）。 */
export interface SessionModelCatalogFailure {
  readonly id: string;
  readonly name: string;
  readonly message: string;
}

/** 模型目录（上游 `ModelCatalog`）。 */
export interface SessionModelCatalogValue {
  readonly default: SessionModelSelection;
  readonly routableProviders: readonly string[];
  readonly groups: readonly SessionModelProviderGroup[];
  readonly failures: readonly SessionModelCatalogFailure[];
}

/** `session/rename` 的请求。 */
export interface SessionRenameRequest {
  readonly sessionId: string;
  readonly title: string;
}

/** `session/rename` 的响应：被接受的标题与提交它的持久事件位置。 */
export interface SessionRenameValue {
  readonly title: string;
  readonly seq: number;
}

/** `session/selectModel` 的请求。 */
export interface SessionSelectModelRequest extends SessionModelSelection {
  readonly sessionId: string;
}

/** `session/selectModel` 的响应。 */
export interface SessionSelectModelValue {
  readonly selected: SessionModelSelection;
}

/** `session/fork` 的请求：源会话、可选的包含式事件边界、迁移预检开关。 */
export interface SessionForkRequest {
  readonly sessionId: string;
  readonly atSeq?: number;
  readonly allowMigration?: boolean;
}

/** `session/fork` 的响应：新会话身份。 */
export interface SessionForkValue {
  readonly sessionId: string;
}

/** `session/search` 的请求：字面量内容查询。 */
export interface SessionSearchRequest {
  readonly query: string;
}

/** 一条搜索结果（上游 `SessionSearchItem`）。 */
export interface SessionSearchItem {
  readonly sessionId: string;
  readonly snippet: string;
}

/** `session/search` 的响应。 */
export interface SessionSearchValue {
  readonly items: readonly SessionSearchItem[];
  readonly hasMore: boolean;
}

/** `session/workspacePathApplications` 的请求。 */
export interface SessionWorkspacePathApplicationsRequest {
  /** Host 文件系统语法下的路径。 */
  readonly path: string;
}

/** 桌面上的一个文件处理程序（上游 `SessionWorkspacePathApplication`）。 */
export interface SessionWorkspacePathApplication {
  readonly id: string;
  readonly name: string;
  readonly default: boolean;
  /** PNG/SVG data URL，或 `null`（桌面不给图标）。 */
  readonly icon: string | null;
}

/** 一条 prompt 内容（上游 `PromptContentPart`）。 */
export type SessionPromptContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      readonly data: string;
      readonly name?: string;
    }
  | { readonly type: "file"; readonly receiptId: string };

/** 一条队列操作（上游 `QueueAction`）。 */
export type SessionQueueAction =
  | { readonly kind: "edit"; readonly content: readonly { readonly type: "text"; readonly text: string }[] }
  | { readonly kind: "remove" }
  | { readonly kind: "steer" };

/** `session/prompt` 的请求。 */
export interface SessionPromptRequest {
  /** 客户端铸的请求身份（与 `beginSubmission` 的 echo 对账）。 */
  readonly requestId: string;
  readonly sessionId: string;
  readonly mode: "queue" | "steer";
  /** 至少一段非空白文本或一个附件。 */
  readonly content: readonly SessionPromptContentPart[];
  readonly clientTimeZone?: string;
}

/** `session/prompt` 的响应。 */
export interface SessionPromptValue {
  readonly accepted: true;
}

/** `session/cancel` 的请求。 */
export interface SessionCancelRequest {
  readonly sessionId: string;
}

/** `session/updateQueue` 的请求。 */
export interface SessionUpdateQueueRequest {
  readonly sessionId: string;
  /** agent 侧 inbox 出现项身份。 */
  readonly itemId: string;
  readonly action: SessionQueueAction;
}

/** `cancel` / `updateQueue` 的响应。 */
export interface SessionAcceptedValue {
  readonly accepted: true;
}

/** 一条会话行（上游 `SessionSummary` 的装配内形态；客户端在边界摊平 `projections.values`）。 */
export interface SessionSummaryRow {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly cwd: string;
  readonly blank: boolean;
  readonly running: boolean;
  readonly agentAvailable: boolean;
  readonly updatedAt: number;
  readonly retainedBy: Readonly<Record<string, number>>;
  /**
   * 投影摘要（`kind` + 水位 + 值）。`agentPreset` 由 `session.header.agentPreset` 提供：
   * **不能省成一个空对象**，`ui-workspace` 的 `restoreBlank` 读它，拿不到字符串就会走「新建会话」分支。
   */
  readonly projections?: {
    readonly kind: "sequenced";
    readonly asOfSeq: number;
    /** 客户端的 `projectionValues`：键是投影名（`agentPreset` / `modelSelection` / `title` …）。 */
    readonly values: Readonly<Record<string, unknown>>;
  };
}

/** `session/list` 的响应：目录身份表与逐行快照。 */
export interface SessionListValue {
  readonly ids: readonly string[];
  readonly byId: Readonly<Record<string, SessionSummaryRow>>;
}

/** `session/create` 的请求：位置（workspace 或 cwd，二选一）、可复用的空白会话身份、agent preset。 */
export interface SessionCreateRequest {
  readonly workspaceId?: string;
  readonly cwd?: string;
  /** 复用一个已有的空白会话（`ui-workspace` 的 `restoreBlank` 每次 reload 都会带它）。 */
  readonly sessionId?: string;
  readonly agentPreset?: string;
}

/** `session/create` 的响应：会话身份。会话行本身由 `api-session/added` 推送，不在响应里回。 */
export interface SessionCreateValue {
  readonly sessionId: string;
}

/** wire 上的一条会话事件（上游 `SessionWireEvent`）：`data` 是不透明 JSON 载荷。 */
export interface SessionWireEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: true;
}

/** 历史窗口里的一条记录（上游 `SessionHistoryRecord`）：本装配只投事件记录。 */
export interface SessionHistoryRecord {
  readonly type: "event";
  readonly event: SessionWireEvent;
}

/** `session/page` 的请求：目标会话与续读位置。 */
export interface SessionPageRequest {
  readonly sessionId: string;
  /** 从哪条事件之后读（缺省 = 最新一页）。 */
  readonly throughSeq?: number;
}

/** `session/page` 的响应（上游 `SessionPage`）。 */
export interface SessionPageValue {
  readonly records: readonly SessionHistoryRecord[];
  readonly hasMore: boolean;
}

/** `session/follow` 的请求：打开哪个会话的窗口。 */
export interface SessionFollowRequest {
  readonly address: { readonly sessionId: string };
}

/** `session/follow` 的首帧（上游 `SessionFollowFrame` 的 `snapshot` 分支）：打开窗口的基线。 */
export interface SessionFollowSnapshot {
  readonly type: "snapshot";
  readonly header: {
    readonly version: number;
    readonly id: string;
    readonly createdAt: number;
    readonly isSeeded: boolean;
    readonly cwd?: string;
  };
  readonly cursor: number;
  readonly records: readonly SessionHistoryRecord[];
  readonly hasMore: boolean;
  readonly projections: { readonly asOfSeq: number; readonly values: Readonly<Record<string, unknown>> };
}

/** `session/follow` 的一帧：基线快照或后续事件记录。 */
export type SessionFollowFrame = SessionFollowSnapshot | SessionHistoryRecord;

/** `session` 组：目录（建档 / 列表 / 翻页 / 跟随）、改名、选模型、分叉、搜索、目录与桌面能力；
 * `prompt` / `cancel` / `updateQueue` 是会话语义。 */
@RemoteGroup({ name: "session" })
export class SessionEndpoint {
  /**
   * 列出一条目录：会话身份表与逐行快照。
   * @returns 目录身份表与逐行快照。
   */
  @RemoteMethod()
  async list(): Promise<SessionListValue> {
    throw new Error("session/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 建一个会话（可复用已有的空白会话）。
   *
   * 上游语义是**会话与 agent 一起建**（`agents.createSession` → `AgentLoop.create`）：只把会话塞进
   * store 而不起 agent，后续 `prompt` 的 resume 会撞 `session "<id>" already exists`。
   * @param _request - 位置、可复用身份与 agent preset。
   * @returns 会话身份。
   */
  @RemoteMethod()
  async create(_request: SessionCreateRequest): Promise<SessionCreateValue> {
    throw new Error("session/create：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读一页历史。
   * @param _request - 目标会话与续读位置。
   * @returns 这一页的记录与是否还有更多。
   */
  @RemoteMethod()
  async page(_request: SessionPageRequest): Promise<SessionPageValue> {
    throw new Error("session/page：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 打开一个会话窗口：先给基线快照，之后逐帧推事件，直到取消。
   * @param _request - 目标会话。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 基线快照与后续事件帧。
   */
  @RemoteMethod({ mode: "stream" })
  follow(_request: SessionFollowRequest, _signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    throw new Error("session/follow：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 改一个会话的标题（会往会话日志写事件）。
   * @param _request - 会话与提议的标题。
   * @returns 被接受的标题与事件位置。
   */
  @RemoteMethod()
  async rename(_request: SessionRenameRequest): Promise<RemoteResultWire<SessionRenameValue>> {
    throw new Error("session/rename：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 为一个会话选模型（Host 侧随后后台保存为默认）。
   * @param _request - 会话与目标选择。
   * @returns 归一化后的选择。
   */
  @RemoteMethod()
  async selectModel(_request: SessionSelectModelRequest): Promise<RemoteResultWire<SessionSelectModelValue>> {
    throw new Error("session/selectModel：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 从一个会话的精确事件前缀分叉出新会话。
   * @param _request - 源会话、可选边界与迁移预检开关。
   * @returns 新会话身份。
   */
  @RemoteMethod()
  async fork(_request: SessionForkRequest): Promise<RemoteResultWire<SessionForkValue>> {
    throw new Error("session/fork：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 搜索可见会话内容（不恢复 agent）。
   * @param _request - 查询文本。
   * @returns 有界结果。
   */
  @RemoteMethod()
  async search(_request: SessionSearchRequest): Promise<RemoteResultWire<SessionSearchValue>> {
    throw new Error("session/search：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 读当前可路由的全部模型（选择器用）。
   * @returns 按 provider 分组的目录、默认选择与失败面。
   */
  @RemoteMethod()
  async modelCatalog(): Promise<RemoteResultWire<SessionModelCatalogValue>> {
    throw new Error("session/modelCatalog：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 登录后在没有 API key 时选第一个可用模型。
   * @returns 无返回值（默认值已保存）。
   */
  @RemoteMethod()
  async initializeDefaultModel(): Promise<RemoteResultWire<void>> {
    throw new Error("session/initializeDefaultModel：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 报告这个部署能不能把会话工作区路径交给桌面打开。
   * @returns `true` 表示可打开。
   */
  @RemoteMethod()
  async canOpenWorkspacePath(): Promise<RemoteResultWire<boolean>> {
    throw new Error("session/canOpenWorkspacePath：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 发一条 prompt（Host 可能挂起到 admit 阶段）。
   * @param _request - 会话、内容、投递模式与请求身份。
   * @returns 已接受的回执。
   */
  @RemoteMethod()
  async prompt(_request: SessionPromptRequest): Promise<RemoteResultWire<SessionPromptValue>> {
    throw new Error("session/prompt：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 取消正在跑的 turn（队列里的工作保留）。
   * @param _request - 会话。
   * @returns 已接受的回执。
   */
  @RemoteMethod()
  async cancel(_request: SessionCancelRequest): Promise<RemoteResultWire<SessionAcceptedValue>> {
    throw new Error("session/cancel：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 对仍 pending 的队列项做一次 edit / remove / steer。
   * @param _request - 会话、队列项与动作。
   * @returns 已接受的回执。
   */
  @RemoteMethod()
  async updateQueue(_request: SessionUpdateQueueRequest): Promise<RemoteResultWire<SessionAcceptedValue>> {
    throw new Error("session/updateQueue：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 列出一个路径当前的桌面文件处理程序。
   * @param _request - Host 文件系统语法下的路径。
   * @returns 应用列表；桌面打开不可用时为空数组。
   */
  @RemoteMethod()
  async workspacePathApplications(
    _request: SessionWorkspacePathApplicationsRequest,
  ): Promise<RemoteResultWire<readonly SessionWorkspacePathApplication[]>> {
    throw new Error("session/workspacePathApplications：契约类未实现（宿主侧要在子类里实现它）");
  }
}
