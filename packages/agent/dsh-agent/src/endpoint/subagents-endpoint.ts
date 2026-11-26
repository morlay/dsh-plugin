// `subagents` 这一组的**跨端契约**：组名、组内方法名、请求/响应形状，以及 wire 上的端点名。
//
// 两端共用同一份声明：宿主侧继承它并实现方法（`server/`）；浏览器侧用 `@RemoteClient()` 生成转发（当前没有远端端点消费它）。
// **只在这里声明形状**：不 import 任何 `@deepseek-ai/*`（那是宿主半的实现依赖，浏览器侧会把宿主拖进打包图）。
// 形状照上游 descriptor 与 `SubagentRuntime` 的公开面抄：`vendor/.../subagent/subagent/lib/typert.client.ts:49-100`。
//
// **它不继承 `RemoteClientBase`**：那个基类带一个 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务（`service "remote" is not available`）。
// 浏览器侧那份自己显式声明 `remote = inject(Remote)`（照 `dsh-command` 的 `command-endpoint.client.ts`）。
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam } from "@morlay/zephyr-app/typert";
import type {
  SubagentInterruptReceipt,
  SubagentPromptReceipt,
  SubagentPromptRequest as UpstreamPromptRequest,
  SubagentRuntime as SubagentRuntimeHost,
} from "@deepseek-ai/dsh-subagent";
import { RemoteGroup, RemoteMethod, groupNameOf } from "@morlay/zephyr-app/remote";

/** 一条 prompt 的内容片段（上游 `SubagentPromptRequest["content"]` 的元素）。 */
export type SubagentPromptContentPart = UpstreamPromptRequest["content"][number];

/** `subagents/prompt` 的请求：**就是上游那份**（wire 形参名 `request`）。 */
export type SubagentPromptRequest = UpstreamPromptRequest;

/** `subagents/prompt` 的回执（上游 `SubagentPromptReceipt`）。 */
export type SubagentPromptValue = SubagentPromptReceipt;

/** `subagents/interruptByUser` 的回执（上游 `SubagentInterruptReceipt`）。 */
export type SubagentInterruptByUserValue = SubagentInterruptReceipt;

/**
 * 组名（`subagents`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 */
export function subagentsGroupName(): string {
  return groupNameOf(SubagentsEndpoint);
}

/** `subagents` 组：子代理续话（prompt）与按会话中断。 */
@RemoteGroup({ name: "subagents" })
export class SubagentsEndpoint {
  /**
   * 给一个已存在的子代理续一条人类消息。
   * @param _request - 身份、投递方式与内容片段（wire 名 `request`）。
   * @returns 被接受的消息回执（裸值；失败是异常）。
   */
  @RemoteMethod({ parameters: ["request"] })
  async prompt(_request: SubagentPromptRequest): Promise<SubagentPromptValue> {
    throw new Error("subagents/prompt：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 用户侧中断一个活着的子代理。
   * @param _childSessionId - 目标子会话（wire 名 `childSessionId`）。
   * @returns 取消信号已受理（不代表目标已静止）。
   */
  @RemoteMethod({ parameters: ["childSessionId"] })
  async interruptByUser(
    _childSessionId: Parameters<SubagentRuntimeHost["interruptByUser"]>[0],
  ): Promise<SubagentInterruptByUserValue> {
    throw new Error("subagents/interruptByUser：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * 覆盖守卫：契约对上**宿主类** `SubagentRuntime` 的 wire 面（形参与返回双向）。
 * `prompt` 末尾带 `signal`（走 cancellation）→ 投影里摘掉；本组无 lookup 形参。
 */
type SubagentsWire = AsyncReturn<DropParam<SubagentRuntimeHost, AbortSignal>>;

export type SubagentsEndpointCovered = AssertTrue<
  AssertWireFace<Pick<SubagentsWire, "prompt" | "interruptByUser">, Pick<SubagentsEndpoint, "prompt" | "interruptByUser">>
>;