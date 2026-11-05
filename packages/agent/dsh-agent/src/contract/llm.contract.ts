// LLM 运行时契约：令牌按服务语义命名（上游注册名 `llm`）。
import { LlmRuntime } from "../index.ts";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

// 能力词汇：一次模型调用进出的消息、内容块与它们的身份。上游把它们散在 `@deepseek-ai/dsh-llm` 的
// message / types / brand 三个模块里，这里按「LLM 消息」归成一处。
/** 用户消息：一条 `user/message` 事件的 data 就是它。 */
export type { UserMessage } from "@deepseek-ai/dsh-llm";
/** 助手消息：含推理块与工具调用块。 */
export type { AssistantMessage } from "@deepseek-ai/dsh-llm";
/** 消息内容的联合（文本 / 推理 / 工具调用 / 图片 / 文件 …）。 */
export type { ContentBlock } from "@deepseek-ai/dsh-llm";
/** 消息的来源（用户 / 模型 / 工具 / 压缩检查点 …）。 */
export type { MessageSource } from "@deepseek-ai/dsh-llm";
/** 消息身份：品牌类型与同名铸造函数（两用，所以按值转出）。 */
export { MessageId } from "@deepseek-ai/dsh-llm";
/** 造一条用户消息（纯函数）。 */
export { createUserMessage } from "@deepseek-ai/dsh-llm";
/** 深冻结一条消息：进会话日志的事件此后不可变（纯函数）。 */
export { freezeMessage } from "@deepseek-ai/dsh-llm";

/**
 * 契约面：上游 `LlmRuntime` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.llm.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type LlmCovered = AssertTrue<AssertCovered<LlmRuntime, Llm>>;

@Injectable()
export abstract class Llm {
  abstract readonly typertRemote: LlmRuntime["typertRemote"];

  abstract readonly registerAdapter: LlmRuntime["registerAdapter"];

  abstract readonly listProviders: LlmRuntime["listProviders"];

  abstract readonly registerConfigurableProviders: LlmRuntime["registerConfigurableProviders"];

  abstract readonly listConfigurableProviders: LlmRuntime["listConfigurableProviders"];

  abstract readonly registerModelDiscovery: LlmRuntime["registerModelDiscovery"];

  abstract readonly discoverModels: LlmRuntime["discoverModels"];

  abstract readonly remoteDiscoverModels: LlmRuntime["remoteDiscoverModels"];

  abstract readonly providerRetryPolicy: LlmRuntime["providerRetryPolicy"];

  abstract readonly imageRequestPricing: LlmRuntime["imageRequestPricing"];

  abstract readonly imageRequestTarget: LlmRuntime["imageRequestTarget"];

  abstract readonly fileRequestText: LlmRuntime["fileRequestText"];

  abstract readonly listModels: LlmRuntime["listModels"];

  abstract readonly resolveModelInfo: LlmRuntime["resolveModelInfo"];

  abstract readonly resolveCallConfig: LlmRuntime["resolveCallConfig"];

  abstract readonly prepareCall: LlmRuntime["prepareCall"];

  abstract readonly stream: LlmRuntime["stream"];
}
