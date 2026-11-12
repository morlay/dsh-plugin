/**
 * Model-visible messages owned by continuable-subagent orchestration, with this
 * deployment's Chinese result-delivery guidance.
 *
 * 上游那一份（`./vendor/dsh-subagent/continuation-messages.ts`）原样再导出，本文件只加两件事：
 * 按会话挑选中英文的判据 `localizedReturnGuidance`，以及中文版的 `withResultDeliveryGuidance`。
 * 声明（`MessageSourceMap` 的 `subagent-settled`）只在上游那一份里，避免同一属性两份类型。
 *
 * @module @deepseek-ai/dsh-subagent/continuation-messages
 */

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

export {
  createAgentMessage,
  createSettlementMessage,
} from "./vendor/dsh-subagent/continuation-messages.ts";
export type {
  AgentMessageSource,
  SubagentSettledMessageSource,
} from "./vendor/dsh-subagent/continuation-messages.ts";

/**
 * Whether this session's return guidance takes this package's Chinese wording.
 *
 * **默认对任意 preset 生效**：名单（本行的 `config.localizedReturnGuidancePresets`）不配就是不限制——官方四个
 * shipped preset、部署自建的、以及还没绑 preset 的会话（不装 registry 的部署、还没 join 的 agent）都拿中文。
 * 配了名单才反过来收窄成"只有这些 preset 的会话用中文"。文案是模型可见的东西，判据留在 host 平面
 * （`subagents` 是进程单例，这一行不能搬进 preset realm）。
 *
 * @param composedPreset - the preset id the session is mounted on, if any.
 * @param configured - preset ids this deployment restricts the Chinese wording to; empty means every session.
 * @returns whether the Chinese guidance applies to this session.
 */
export function localizedReturnGuidance(
  composedPreset: string | undefined,
  configured: readonly string[],
): boolean {
  if (configured.length === 0) return true;
  return composedPreset !== undefined && configured.includes(composedPreset);
}

/**
 * Append automatic result-delivery guidance to a parent-delivered child's initial task.
 * @param prompt - initial model-visible task blocks.
 * @returns task blocks followed by the result-delivery guidance.
 */
export function withResultDeliveryGuidance(prompt: ContentBlock[]): ContentBlock[] {
  return [
    ...prompt,
    {
      type: "text",
      text:
        "你的最终答案会在父智能体仍在线时自动送达：把结果与相关证据写进这条答案，父智能体收不到你的" +
        "完整对话、工具输出与推理过程。如果你的最后一个动作是给父智能体发消息，完成通知会省略你的" +
        "最终答案——那就把结果与相关证据写进那条消息。",
    },
  ];
}
