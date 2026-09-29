import type { Agent } from "@deepseek-ai/dsh-agent";
import { Service, type Context } from "@deepseek-ai/cordis";
import { renderReminder } from "./reminder.ts";

interface AgentState {
  // 本步装配降级出来的 section 条目：id → 正文（未渲染信封）。
  sections: ReadonlyMap<string, string>;
}

// 注入通道：装配结果上的**文本改写**（`replaceSection` / `suppressSection`）与降级 section 的按步注入。
//
// 工作区指令与技能目录**不在这里**：那两面用官方行自己的注入方式，本包只做内容转换（把不要的 section 丢掉、
// 把要的换成我们的文案）。覆盖语义（同 id 最新取代更早）由系统提示词里的声明说明一次，见
// [`rules.ts`](./rules.ts)。
export class ContextAssembler extends Service {
  private readonly replacements = new Map<string, string>();
  private readonly suppressed = new Set<string>();
  private readonly states = new WeakMap<Agent, AgentState>();
  // 不要 instruction 类注入的会话（模式说了 `instructions: false`）：降级 section 不进提示词。
  private readonly withoutInstructions = new WeakSet<Agent>();

  constructor(ctx: Context) {
    super(ctx, "contextAssembler");
  }

  // 装配结果上把这个 section 的文本换成 `text`。
  replaceSection(name: string, text: string): () => void {
    this.replacements.set(name, text);
    return () => {
      if (this.replacements.get(name) === text) this.replacements.delete(name);
    };
  }

  suppressSection(name: string): () => void {
    this.suppressed.add(name);
    return () => {
      this.suppressed.delete(name);
    };
  }

  isSuppressed(name: string): boolean {
    return this.suppressed.has(name);
  }

  // 装配结果上该 section 要换成的文本；undefined 表示原样保留。
  replacement(name: string): string | undefined {
    return this.replacements.get(name);
  }

  // 这个会话要不要 instruction 类注入（模式说了 `instructions: false` 就是不要）。
  setInstructions(agent: Agent, on: boolean): void {
    if (on) this.withoutInstructions.delete(agent);
    else this.withoutInstructions.add(agent);
  }

  // 本步要注入的条目：降级出来的 section（id → 正文）。
  collect(agent: Agent): Map<string, string> {
    const entries = new Map<string, string>();
    if (this.withoutInstructions.has(agent)) return entries;
    for (const [id, text] of this.sectionsOf(agent)) entries.set(id, renderReminder(id, text));
    return entries;
  }

  private sectionsOf(agent: Agent): ReadonlyMap<string, string> {
    return this.states.get(agent)?.sections ?? new Map();
  }

  // 每步装配调一次：记下本步降级出来的 section 文本，供下一步注入。
  sync(agent: Agent, input: { readonly sections: ReadonlyMap<string, string> }): void {
    this.stateOf(agent).sections = input.sections;
  }

  private stateOf(agent: Agent): AgentState {
    const existing = this.states.get(agent);
    if (existing !== undefined) return existing;
    const state: AgentState = { sections: new Map() };
    this.states.set(agent, state);
    return state;
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    contextAssembler: ContextAssembler;
  }
}
