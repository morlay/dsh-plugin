// 用户显式引用的内容注入（`agent/pre-step` waterfall）：文件引用要有 read 能力、skill 引用要有 skill 工具，
// 没有对应工具时注入也没有意义。文件系统是可选能力：没有它 skill 注入照常、文件引用保持普通文本。
import { inject, Injectable, input, type Context } from "@morlay/zephyr";
import { Skill as Skills } from "@morlay/dsh-base/skill";
import { Tools } from "@morlay/dsh-base/tool";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import { FileSystem } from "@morlay/dsh-base/fs";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-session";
import {
  isUserInvocable,
  renderSkillContent,
  type SkillInvocationSource,
} from "@deepseek-ai/dsh-skill";
import { readFileContent } from "./file-content.ts";
import { fileReferencesIn, skillNamesIn } from "./links.ts";

// 文件引用注入：`references` 按注入顺序列出这条消息里实际装了的引用（含行窗口）。
export interface FileReferenceSource {
  readonly kind: "file-reference";
  readonly references: readonly import("./links.ts").FileReference[];
}

// 内容之外的一条说明：不说来源，模型会再 read 一遍同一段内容。与内容同处一条消息，多个引用只说一次。
const NOTE = [
  "<system-reminder>",
  "这些文件内容是按你消息里的 @ 引用刚读取的，直接用它即可，不必再 read 一遍。",
  "</system-reminder>",
].join("\n");

interface ToolsLike {
  get(name: string, agent: unknown): unknown;
}

interface PreStepPayload {
  readonly agent: unknown;
  readonly messages: readonly UserMessage[];
  readonly signal: AbortSignal;
}

type PreStepNext = () => Promise<PreStepDecision>;

@Injectable()
export class Reference {
  skills = inject(Skills);

  tools = inject.optional(Tools);

  fs = inject.optional(FileSystem);

  private readonly preStep = input<[PreStepPayload, PreStepNext]>("agent/pre-step");

  onInit(ctx: Context): void {
    ctx.effect(
      () => this.preStep.on((payload, next) => this.attach(payload, next)),
      "reference: agent/pre-step",
    );
  }

  private async attach(payload: PreStepPayload, next: PreStepNext): Promise<PreStepDecision> {
    const decision = await next();
    if (decision.kind === "reject") return decision;
    const tools = this.tools as unknown as ToolsLike | undefined;
    const hasTool = (name: string): boolean =>
      tools === undefined || tools.get(name, payload.agent) !== undefined;
    const names = hasTool("skill") ? skillNamesIn(payload.messages) : [];
    const files = hasTool("read") ? fileReferencesIn(payload.messages) : [];
    if (names.length === 0 && files.length === 0) return decision;
    payload.signal.throwIfAborted();
    const agent = payload.agent as { session: { header: { cwd?: string } } };
    const cwd = agent.session.header.cwd;
    const injections: UserMessage[] = [];
    for (const name of names) {
      const skill = await this.skills.get(name, { cwd, signal: payload.signal, scope: payload.agent as never });
      payload.signal.throwIfAborted();
      if (skill === undefined || !isUserInvocable(skill)) continue;
      const source: SkillInvocationSource = { kind: "skill-invocation", name, form: "instructions" };
      injections.push(
        createUserMessage({
          content: [{ type: "text", text: renderSkillContent(skill) }],
          source,
        }),
      );
    }
    const fs = this.fs;
    const read: import("./links.ts").FileReference[] = [];
    const envelopes: ContentBlock[] = [];
    for (const reference of files) {
      const envelope =
        fs === undefined ? undefined : await readFileContent(fs, reference, { cwd, signal: payload.signal });
      payload.signal.throwIfAborted();
      if (envelope === undefined) continue;
      read.push(reference);
      envelopes.push({ type: "text", text: envelope });
    }
    if (read.length > 0) {
      injections.push(
        createUserMessage({
          content: [{ type: "text", text: NOTE }, ...envelopes],
          // 上游 `MessageSourceMap` 不认识这个 kind（模块增强被禁用）：按契约收窄。
          source: { kind: "file-reference", references: read } as never,
        }),
      );
    }
    if (injections.length === 0) return decision;
    return { ...decision, messages: [...decision.messages, ...injections] };
  }
}
