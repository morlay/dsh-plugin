// 通道那一行：装配结果上的文本转换（`replace` / `suppress`）与降级 section 的按步送达。
// 工作区指令与技能目录走官方行，不经这里；本行只管"装配结果上换文本 / 丢文本 / 把降级的改到 reminder 里"。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { AssembledSection } from "@morlay/dsh-agent/contract";
import { SystemPrompt } from "@morlay/dsh-agent";
import { inject, Injectable, provide, type Context, type OnInit } from "@morlay/zephyr";
import { ContextAssembler } from "./contract/context-assembler.contract.ts";
import { ContextAssemblerDefault } from "./context-assembler.service.ts";
import { DEFAULT_KEEP, DEFAULT_REPLACE, DEFAULT_SUPPRESS } from "./defaults.ts";
import { AgentPreStep, AgentRequestError, SystemPromptAssemble } from "./events.ts";
import { latestReminderText, reminderMessage, RULES_SECTION } from "./reminder.ts";
import { RULES_TEXT } from "./rules.ts";

// 规则声明的位置：紧跟部署 persona（order 0），在任何降级内容之前。
const RULES_ORDER = 1;

// `keep` / `suppress` / `replace` 是可覆盖的 config：缺省就是本部署要的那一份。
export interface ContextAssemblerConfig {
  readonly keep?: readonly string[];
  readonly suppress?: readonly string[];
  readonly replace?: Readonly<Record<string, string>>;
}

function configWithDefaults(input: ContextAssemblerConfig): Required<ContextAssemblerConfig> {
  return {
    keep: [...(input.keep ?? DEFAULT_KEEP)],
    suppress: [...(input.suppress ?? DEFAULT_SUPPRESS)],
    replace: { ...(input.replace ?? DEFAULT_REPLACE) },
  };
}

// 降级 section 的条目 id：一条 section 一个 id，于是同一次变化只重发那一条。
function sectionId(name: string): string {
  return `section:${name}`;
}

// 通道那一行的 Provider：把三份清单装进服务，再把两个送达接缝挂上。
@Injectable()
export class ContextChannel implements OnInit {
  static Config = configWithDefaults;

  readonly assemble$ = new SystemPromptAssemble();

  readonly preStep$ = new AgentPreStep();

  readonly requestError$ = new AgentRequestError();

  private readonly prompt = inject(SystemPrompt);

  private readonly assembler = inject(ContextAssembler);

  private readonly config: Required<ContextAssemblerConfig>;

  constructor(input: ContextAssemblerConfig = {}) {
    this.config = configWithDefaults(input);
  }

  onInit(_ctx: Context): void {
    const keep = new Set(this.config.keep);
    for (const name of this.config.suppress) this.assembler.suppressSection(name);
    for (const [name, text] of Object.entries(this.config.replace)) {
      this.assembler.replaceSection(name, text);
    }
    // 三段清单都显式留空 = 上游原版：不降级、不抑制、不换文案，规则声明也不注册。
    if (
      keep.size > 0 ||
      this.config.suppress.length > 0 ||
      Object.keys(this.config.replace).length > 0
    ) {
      this.prompt.section({ name: RULES_SECTION, order: RULES_ORDER, text: RULES_TEXT });
    }

    this.assemble$.onWaterfall(async (_assembly, context, next) => {
      const result = await next();
      const agent = context.agent as Agent | undefined;
      const demoted = new Map<string, string>();
      const sections: AssembledSection[] = [];
      let changed = false;
      for (const section of result.sections) {
        if (this.assembler.isSuppressed(section.name)) {
          changed = true;
          continue;
        }
        const text = this.assembler.replacement(section.name) ?? section.text;
        if (text !== section.text) changed = true;
        // `keep` 显式留空 = 全部保留（只在有白名单时才把其余 section 降级成 reminder）。
        if (keep.size === 0 || keep.has(section.name) || text.length === 0) {
          sections.push(text === section.text ? section : { ...section, text });
          continue;
        }
        changed = true;
        demoted.set(sectionId(section.name), text);
      }
      if (agent !== undefined) this.assembler.sync(agent, { sections: demoted });
      return changed ? { ...result, sections } : result;
    });

    this.preStep$.onWaterfall(async ({ agent, messages }, next) => {
      const decision = await next();
      if (decision.kind === "reject" || decision.messages.length === 0) return decision;
      const pending = this.pendingEntries(agent);
      if (pending.length === 0) return decision;
      // 落点：本步认领的用户消息**之后**（不是列表末尾）。
      const claimedEnd = decision.messages.findLastIndex((message) => messages.includes(message));
      return {
        ...decision,
        messages: decision.messages.toSpliced(
          claimedEnd + 1,
          0,
          ...pending.map(([id, text]) => reminderMessage(id, text)),
        ),
      };
    });

    // 上游只在首次尝试落库 `decision.messages`，重试是同一批消息的再请求：压缩会吃掉早期 reminder，
    // 重试不重跑 `pre-step`，所以这里补写进会话。
    this.requestError$.onWaterfall(
      async ({ agent, signal }, next) => {
        const action = await next();
        if (action?.kind !== "retry" || signal.aborted) return action;
        for (const [id, text] of this.pendingEntries(agent)) {
          agent.session.append("user/message", reminderMessage(id, text), { surfaceOp: "append" });
        }
        return action;
      },
      // 抢在压缩那一侧的重试监听之前：补写要落在同一次重试决策里（源包同一位置）。
      { prepend: true },
    );
  }

  // 本步要注入的条目（id → 已渲染正文）：同 id 文本未变就不注入，按 id 字典序（顺序不随注册顺序抖动）。
  private pendingEntries(agent: Agent): [string, string][] {
    return [...this.assembler.collect(agent)]
      .filter(([id, text]) => latestReminderText(agent, id) !== text)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  }
}

export const provideContextAssembler = provide([ContextAssemblerDefault, ContextChannel]);
