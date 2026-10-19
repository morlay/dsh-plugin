// 系统提示契约：令牌按服务语义命名（上游注册名 `systemPrompt`）。
import type { SystemPrompt as SystemPromptService } from "@deepseek-ai/dsh-system-prompt";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/** 契约面：上游 `SystemPrompt` 的**全部**公开成员（分节、排序、变量与装配面）。 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SystemPromptCovered = AssertTrue<
  AssertCovered<SystemPromptService, SystemPrompt>
>;

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

