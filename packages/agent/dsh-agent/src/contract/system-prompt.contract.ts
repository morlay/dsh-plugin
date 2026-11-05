// 系统提示契约：令牌按服务语义命名（上游注册名 `systemPrompt`）。
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";
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

/** 契约面：上游 `SystemPrompt` 的**全部**公开成员（分节、排序、变量与装配面）。 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SystemPromptCovered = AssertTrue<AssertCovered<SystemPromptService, SystemPrompt>>;

@Injectable()
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
