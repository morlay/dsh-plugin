// `subagents` 这一组的**跨端契约**：组名、组内方法名、请求/响应形状，以及 wire 上的端点名。
//
// 两端共用同一份声明：宿主侧继承它并实现方法（`server/`），浏览器侧将来用 `@RemoteClient()` 生成转发。
// **只在这里声明形状**：不 import 任何 `@deepseek-ai/*`（那是宿主半的实现依赖，浏览器侧会把宿主拖进打包图）。
// 形状照上游 descriptor 与 `SubagentRuntime` 的公开面抄：`vendor/.../subagent/subagent/lib/typert.client.ts:49-100`。
//
// **它不继承 `RemoteClientBase`**：那个基类带一个 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务（`service "remote" is not available`）。
// 浏览器侧那份自己显式声明 `remote = inject(Remote)`（照 `dsh-command` 的 `command-endpoint-client.ts`）。
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";

/** 组名（上游 descriptor：`namespace: 'subagents'`）。 */
export const SUBAGENTS_GROUP = "subagents";

/** wire 上的端点名（上游 descriptor 的 `namespace/method`）。 */
export const SUBAGENTS_PROMPT_ENDPOINT = "subagents/prompt";
export const SUBAGENTS_INTERRUPT_BY_PARENT_ENDPOINT = "subagents/interruptByParent";

/**
 * 一条 prompt 的内容片段（上游 `PromptContentPart` 的三态）。
 *
 * 图片由宿主在准入时落盘；文件只传**回执 id**（浏览器造不出持久的附件引用）。
 */
export type SubagentPromptContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mediaType: string; readonly data: string; readonly name?: string }
  | { readonly type: "file"; readonly receiptId: string };

/** `subagents/prompt` 的请求（上游 `SubagentPromptRequest`，wire 上是 `{ request }`）。 */
export interface SubagentPromptRequest {
  /** 调用方先铸好的消息身份（落在被接受的那条消息上）。 */
  readonly requestId: string;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  /** 持续地址判别式：浏览器侧的控制地址只认这一个值。 */
  readonly mode: "continuable";
  /** 这条消息排到下一轮还是投给最近的 step。 */
  readonly delivery: "queue" | "steer";
  readonly content: readonly SubagentPromptContentPart[];
  /** 这条人类 prompt 采样到的浏览器时区（可选）。 */
  readonly clientTimeZone?: string;
}

/** `subagents/prompt` 的回执（上游 `SubagentPromptReceipt`）。 */
export interface SubagentPromptValue {
  readonly messageId: string;
}

/** `subagents/interruptByParent` 的请求（上游是**三个命名参数**，不是 `{ request }`）。 */
export interface SubagentInterruptByParentRequest {
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly mode: "continuable";
}

/** `subagents/interruptByParent` 的回执（上游 `SubagentInterruptReceipt`：只表示取消信号被受理）。 */
export interface SubagentInterruptByParentValue {
  readonly accepted: true;
}

/** `subagents` 组：子代理续话（prompt）与按父地址中断。 */
@RemoteGroup({ name: SUBAGENTS_GROUP })
export class SubagentsEndpoint {
  /**
   * 给一个已存在的子代理续一条人类消息。
   * @param _request - 身份、投递方式与内容片段。
   * @returns 被接受的消息身份。
   */
  @RemoteMethod()
  async prompt(_request: SubagentPromptRequest): Promise<RemoteResultWire<SubagentPromptValue>> {
    throw new Error("subagents/prompt：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 按「直接父地址」中断一个活着的子代理（父 agent 离线也可用）。
   * @param _request - 子会话、父会话与判别式。
   * @returns 取消信号已受理（不代表目标已静止）。
   */
  @RemoteMethod()
  async interruptByParent(
    _request: SubagentInterruptByParentRequest,
  ): Promise<RemoteResultWire<SubagentInterruptByParentValue>> {
    throw new Error("subagents/interruptByParent：契约类未实现（宿主侧要在子类里实现它）");
  }
}
