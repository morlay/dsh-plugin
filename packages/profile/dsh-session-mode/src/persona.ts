// 按会话给提示词：把模式的 persona 注册到该 agent 自己的 scope 上（`deployment:persona-prefix` / `-suffix`），
// 跨层遮蔽部署级那层。两个 section 都注册（缺省是空串）；注册与注销都发 `system-prompt/change`。

import type { Agent } from "@deepseek-ai/dsh-agent";
import type { PromptSectionOrderName } from "@deepseek-ai/dsh-system-prompt";
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type { SessionModePersona } from "./modes.ts";

const PREFIX_ORDER: PromptSectionOrderName = "DEPLOYMENT_PERSONA_PREFIX";
const SUFFIX_ORDER: PromptSectionOrderName = "DEPLOYMENT_PERSONA_SUFFIX";

// 把一段 persona 装到该 agent 的 scope 上；返回注销这两个 section 的 disposer（模式切换时先调它）。
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
