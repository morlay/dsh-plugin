// 系统提示契约：令牌按服务语义命名（上游注册名 `systemPrompt`）。
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";
import { SystemPrompt as SystemPromptService } from "@deepseek-ai/dsh-system-prompt";

// 能力词汇：装配结果（分节与上下文）、它们的排序名，以及两个约定小节名。消费方拿它们拼提示词、
// 或按名字问某一节的顺序，不必自己去引 `@deepseek-ai/dsh-system-prompt`。
/** 装配后的一节提示词。 */
export type { AssembledSection } from "@deepseek-ai/dsh-system-prompt";
/** 装配的入参（`assemble(context, …)` 的 `context`）。 */
export type { AssembleContext } from "@deepseek-ai/dsh-system-prompt";
/** 装配后的一段运行时上下文。 */
export type { AssembledContext } from "@deepseek-ai/dsh-system-prompt";
/** 分节排序用的名字（`getSectionOrder` 的入参）。 */
export type { PromptSectionOrderName } from "@deepseek-ai/dsh-system-prompt";
/** 约定小节：人格前缀。 */
export { PERSONA_PREFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";
/** 约定小节：人格后缀。 */
export { PERSONA_SUFFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";

@Injectable({ name: "systemPrompt" })
export abstract class SystemPrompt {
  abstract readonly section: SystemPromptService["section"];

  abstract readonly getSectionOrder: SystemPromptService["getSectionOrder"];

  abstract readonly getContextOrder: SystemPromptService["getContextOrder"];

  abstract readonly context: SystemPromptService["context"];

  abstract readonly suppressRuntimeContext: SystemPromptService["suppressRuntimeContext"];

  abstract readonly tools: SystemPromptService["tools"];

  abstract readonly variable: SystemPromptService["variable"];

  abstract readonly refreshContext: SystemPromptService["refreshContext"];

  abstract readonly assemble: SystemPromptService["assemble"];
}

/**
 * 覆盖守卫（严格）：上游 `SystemPromptService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type SystemPromptCovered = AssertTrue<AssertCoveredStrict<SystemPromptService, SystemPrompt>>;
