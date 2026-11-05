// 子代理两处文案的接管行：都改**装配结果**，不 fork 上游实现。
//
// - 回报指引：`agent/pre-step` 上把已认领消息里那块上游英文换成中文；
// - 委派范围说明：`system-prompt/assemble` 上把 `subagent:delegation` 那条上下文换成中文。
//
// 判据与理由见 `packages/agent-ex/session-mode/.agents/designs/20261106-subagent接管面只搬两处文案.md`。
import { Injectable, type OnInit } from "@morlay/zephyr";
import { AgentPreStep, SystemPromptAssemble } from "../events.ts";
import { DEFAULT_PRESET } from "../session-mode.service.ts";
import { isDelegatedAgent, rewordedContext } from "./delegation-context.ts";
import { localizedGuidanceApplies, rewordGuidanceContent } from "./return-guidance.ts";

// 装配面配置：中文回报指引限定在哪些 preset 里（留空 = 不限），以及本部署那一个 preset id。
//
// `preset` 与 `SessionModeDefault` 的同一个字段默认值一致：本部署只装它那一份行清单，不向官方 roster 询问。
export interface SubagentGuidanceConfig {
  readonly localizedReturnGuidancePresets?: readonly string[];
  readonly preset?: string;
}

function normalizeConfig(input: SubagentGuidanceConfig = {}): Required<SubagentGuidanceConfig> {
  return {
    localizedReturnGuidancePresets: [...(input.localizedReturnGuidancePresets ?? [])],
    preset: input.preset ?? DEFAULT_PRESET,
  };
}

@Injectable()
export class SubagentGuidance implements OnInit {
  static Config = normalizeConfig;

  readonly assemble$ = new SystemPromptAssemble();

  readonly preStep$ = new AgentPreStep();

  private readonly config: Required<SubagentGuidanceConfig>;

  constructor(input: SubagentGuidanceConfig = {}) {
    this.config = normalizeConfig(input);
  }

  onInit(): void {
    this.assemble$.onWaterfall(async (assembly, context, next) => {
      const result = await next();
      if (!isDelegatedAgent(context.agent)) return result;
      const contexts = result.contexts.map((entry) => rewordedContext(entry));
      const changed = contexts.some((entry, index) => entry !== result.contexts[index]);
      return changed ? { ...result, contexts } : result;
    });

    this.preStep$.onWaterfall(async ({ agent }, next) => {
      const decision = await next();
      // 指引只出现在子代理的首条任务上：父会话的装配与消息表都不动。
      if (decision.kind === "reject" || !isDelegatedAgent(agent)) return decision;
      if (!this.wantsChinese()) return decision;
      let changed = false;
      const messages = decision.messages.map((message) => {
        const content = rewordGuidanceContent(message.content);
        if (content === undefined) return message;
        changed = true;
        return { ...message, content };
      });
      return changed ? { ...decision, messages } : decision;
    });
  }

  // 这个会话要不要中文回报指引：名单留空就是不限。
  private wantsChinese(): boolean {
    return localizedGuidanceApplies(this.presetOf(), this.config.localizedReturnGuidancePresets);
  }

  // 部署那一个 preset id：本部署只装它那一份行清单，不再向官方 roster 询问，也不按 agent 的 ctx 分叉。
  private presetOf(): string {
    return this.config.preset;
  }
}
