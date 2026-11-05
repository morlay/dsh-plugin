// 提示词通道的契约：装配结果上的文本改写（`replaceSection` / `suppressSection`）与降级 section 的按步送达。
import type { Agent } from "@morlay/dsh-agent/contract";
import { Injectable } from "@morlay/zephyr";

// 一条要按步注入的条目：id 是幂等键（一条 section 一个 id），正文已套好信封。
export type AssemblerEntries = ReadonlyMap<string, string>;

// `name` 是上游服务名别名：源包与上游别的行按 `ctx.contextAssembler` 读这一份。
@Injectable({ name: "contextAssembler" })
export abstract class ContextAssembler {
  // 装配结果上把这个 section 的文本换成 `text`；返回撤销函数。
  abstract replaceSection(name: string, text: string): () => void;

  // 这个 section 不进提示词；返回撤销函数。
  abstract suppressSection(name: string): () => void;

  abstract isSuppressed(name: string): boolean;

  // 装配结果上该 section 要换成的文本；`undefined` 表示原样保留。
  abstract replacement(name: string): string | undefined;

  // 这个会话要不要 instruction 类注入（模式说 `instructions: false` 就是不要）。
  abstract setInstructions(agent: Agent, on: boolean): void;

  // 本步要注入的条目：降级出来的 section（id → 已渲染正文，含信封）。
  abstract collect(agent: Agent): AssemblerEntries;

  // 每步装配调一次：记下本步降级出来的 section 文本（id → 正文，未套信封），供下一步注入。
  abstract sync(agent: Agent, input: { readonly sections: AssemblerEntries }): void;
}
