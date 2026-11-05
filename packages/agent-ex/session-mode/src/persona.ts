// 按会话给提示词：把模式的 persona 注册到该 agent 自己的 scope 上（`deployment:persona-prefix` / `-suffix`），
// 跨层遮蔽部署级那层。两个 section 都注册（缺省是空串）。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { PromptSectionOrderName } from "@morlay/dsh-agent/contract";
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from "@morlay/dsh-agent/contract";
import type { SessionModePersona } from "./endpoint/mode-config.ts";
import type { Context } from "@morlay/zephyr";

const PREFIX_ORDER: PromptSectionOrderName = "DEPLOYMENT_PERSONA_PREFIX";
const SUFFIX_ORDER: PromptSectionOrderName = "DEPLOYMENT_PERSONA_SUFFIX";

// 把一段 persona 装到该 agent 的 scope 上；返回注销这两个 section 的 disposer（模式切换时先调它）。
export function installPersona(agent: Agent, persona: SessionModePersona): () => void {
  const prompt = (agent.ctx as unknown as Context).systemPrompt;
  const disposers = [
    prompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: prompt.getSectionOrder(PREFIX_ORDER),
      text: persona.prefix,
    }),
    prompt.section({
      name: PERSONA_SUFFIX_SECTION,
      order: prompt.getSectionOrder(SUFFIX_ORDER),
      text: persona.suffix,
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
