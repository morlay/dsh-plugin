/**
 * 按会话给提示词：把模式的 persona 注册到**该 agent 自己的 scope** 上。
 *
 * 为什么不是一行 `@deepseek-ai/dsh-persona`：那一行只能按 scope 遮蔽，得先有一棵 preset 子树。这里走的是
 * 上游自己给子 agent 用的那条路——在 `agent.ctx` 上注册同名 section（`deployment:persona-prefix` /
 * `-suffix`），跨层遮蔽部署级那层，不需要任何子树。
 *
 * 两个 section 都注册（哪怕只给了一段文本）：suffix 缺省就是空串，语义与上游 persona 行一致。注册与
 * 注销都发 `system-prompt/change`，所以模式切换后下一次装配自然读到新文本。
 */

import type { Agent } from "@deepseek-ai/dsh-agent";
import type { PromptSectionOrderName } from "@deepseek-ai/dsh-system-prompt";
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type { SessionModePersona } from "./modes.ts";

const PREFIX_ORDER: PromptSectionOrderName = "DEPLOYMENT_PERSONA_PREFIX";
const SUFFIX_ORDER: PromptSectionOrderName = "DEPLOYMENT_PERSONA_SUFFIX";

/**
 * 把一段 persona 装到该 agent 的 scope 上。
 * @param agent - 目标 agent（用它的 `ctx` 定作用域）。
 * @param persona - 模式的提示词；缺省时两段都注册成空串，等于遮蔽掉部署级那层。
 * @returns 注销这两个 section 的 disposer（模式切换时先调它）。
 */
export function installPersona(agent: Agent, persona: SessionModePersona | undefined): () => void {
  const prompt = agent.ctx.systemPrompt;
  const disposers = [
    prompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: prompt.getSectionOrder(PREFIX_ORDER),
      text: persona?.prefix ?? "",
    }),
    prompt.section({
      name: PERSONA_SUFFIX_SECTION,
      order: prompt.getSectionOrder(SUFFIX_ORDER),
      text: persona?.suffix ?? "",
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
