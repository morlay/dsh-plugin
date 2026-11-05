// 提示词通道：装配结果上的文本改写，与降级 section 的按步送达。
import type { Agent } from "@morlay/dsh-agent/contract";
import { Injectable } from "@morlay/zephyr";
import { ContextAssembler, type AssemblerEntries } from "./contract/context-assembler.contract.ts";
import { renderReminder } from "./reminder.ts";

interface AgentState {
  // 本步装配降级出来的 section 条目：id → 正文（未渲染信封）。
  sections: AssemblerEntries;
}

@Injectable()
export class ContextAssemblerDefault extends ContextAssembler {
  private readonly replacements = new Map<string, string>();

  private readonly suppressed = new Set<string>();

  private readonly states = new WeakMap<Agent, AgentState>();

  // 不要 instruction 类注入的会话（模式说了 `instructions: false`）：降级 section 不进提示词。
  private readonly withoutInstructions = new WeakSet<Agent>();

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

  replacement(name: string): string | undefined {
    return this.replacements.get(name);
  }

  setInstructions(agent: Agent, on: boolean): void {
    if (on) this.withoutInstructions.delete(agent);
    else this.withoutInstructions.add(agent);
  }

  collect(agent: Agent): AssemblerEntries {
    const entries = new Map<string, string>();
    if (this.withoutInstructions.has(agent)) return entries;
    for (const [id, text] of this.states.get(agent)?.sections ?? new Map<string, string>()) {
      entries.set(id, renderReminder(id, text));
    }
    return entries;
  }

  sync(agent: Agent, input: { readonly sections: AssemblerEntries }): void {
    const existing = this.states.get(agent);
    if (existing !== undefined) {
      existing.sections = input.sections;
      return;
    }
    this.states.set(agent, { sections: input.sections });
  }
}
