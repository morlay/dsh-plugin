import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { AssembledSection } from "@deepseek-ai/dsh-system-prompt";
import { ContextAssembler, type PromptEntry } from "./channel.ts";
import { DEFAULT_KEEP, DEFAULT_REPLACE, DEFAULT_SUPPRESS } from "./defaults.ts";
import { RULES_SECTION, latestReminderText, reminderMessage } from "./reminder.ts";
import { RULES_TEXT } from "./rules.ts";

export { DEFAULT_KEEP, DEFAULT_REPLACE, DEFAULT_SUPPRESS } from "./defaults.ts";
export type {
  InjectionMode,
  PromptEntry,
  PromptRuleDeclaration,
  PromptSkillDeclaration,
} from "./channel.ts";
export { ContextAssembler } from "./channel.ts";
export { renderVirtualSkill } from "./reminder.ts";

export const name = "context-assembler";

/** 规则声明的位置：紧跟部署 persona（order 0），在任何降级内容之前。 */
const RULES_ORDER = 1;

export const inject = ["systemPrompt", "skills"];

export interface Config {
  /** 留在系统提示词里的 section 名；其余非空 section 降级为 reminder。 */
  keep?: string[];
  /** 不进提示词的 section 名（部署级噪音）。 */
  suppress?: string[];
  /** 装配结果上改写的 section 文本（section 名 → 中文文案）。 */
  replace?: Record<string, string>;
}

export const Config: z<Config> = z.object({
  keep: z.array(z.string()).default([...DEFAULT_KEEP]),
  suppress: z.array(z.string()).default([...DEFAULT_SUPPRESS]),
  replace: z.dict(z.string()).default({ ...DEFAULT_REPLACE }),
});

/**
 * 提示词注入的唯一通道：system prompt 里只留 `keep`，其余内容按声明的方式到达模型——
 * 降级为紧随用户消息的 reminder、或直接丢弃（写进按需 skill 正文是调用方自己的事）。
 */
export function apply(ctx: Context, config: Config): void {
  const channel = new ContextAssembler(ctx);
  const keep = new Set(config.keep ?? DEFAULT_KEEP);
  for (const name of config.suppress ?? DEFAULT_SUPPRESS) channel.suppressSection(name);
  for (const [name, text] of Object.entries(config.replace ?? DEFAULT_REPLACE)) {
    channel.replaceSection(name, () => text);
  }

  ctx.systemPrompt.section({ name: RULES_SECTION, order: RULES_ORDER, text: RULES_TEXT });

  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const result = await next();
    const agent = context.agent;
    const demoted = new Map<string, string>();
    const sections: AssembledSection[] = [];
    let changed = false;

    for (const section of result.sections) {
      if (channel.isSuppressed(section.name)) {
        changed = true;
        continue;
      }
      const text = channel.replacement(section.name, agent) ?? section.text;
      if (text !== section.text) changed = true;
      if (keep.has(section.name) || text.length === 0) {
        sections.push(text === section.text ? section : { ...section, text });
        continue;
      }
      changed = true;
      demoted.set(sectionId(section.name), text);
    }

    if (agent !== undefined) channel.sync(agent, { sections: demoted });
    return changed ? { ...result, sections } : result;
  });

  ctx.on("agent/pre-step", async ({ agent, messages }, next) => {
    const decision = await next();

    if (decision.kind === "reject" || decision.messages.length === 0) return decision;
    const pending = await pendingEntries(agent, channel);
    if (pending.length === 0) return decision;

    const claimedEnd = decision.messages.findLastIndex((message) => messages.includes(message));
    return {
      ...decision,
      messages: decision.messages.toSpliced(
        claimedEnd + 1,
        0,
        ...pending.map(([key, entry]) => reminderMessage(key, entry.text, entry.source)),
      ),
    };
  });

  ctx.on(
    "agent/request-error",
    async ({ agent, signal }, next) => {
      const action = await next();
      if (action?.kind !== "retry" || signal.aborted) return action;
      for (const [key, entry] of await pendingEntries(agent, channel)) {
        agent.session.append("user/message", reminderMessage(key, entry.text, entry.source), {
          surfaceOp: "append",
        });
      }
      return action;
    },
    { prepend: true },
  );
}

/** 降级 section 的条目 id：一条 section 一个 id，于是同一次变化只重发那一条。 */
function sectionId(name: string): string {
  return `section:${name}`;
}

/** 本步要注入的条目：键相同且文本未变就不注入，按键字典序（顺序不随注册顺序抖动）。 */
async function pendingEntries(
  agent: Parameters<typeof latestReminderText>[0],
  channel: ContextAssembler,
): Promise<[string, PromptEntry][]> {
  const entries = await channel.collect(agent);
  return [...entries]
    .filter(([key, entry]) => latestReminderText(agent, key) !== entry.text)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}
