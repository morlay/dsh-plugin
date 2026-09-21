import type { Context } from "@deepseek-ai/cordis";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-fs";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-session";
import {
  isUserInvocable,
  renderSkillContent,
  type SkillInvocationSource,
} from "@deepseek-ai/dsh-skill";
import { readFileContent } from "./file-content.ts";
import { fileReferencesIn, skillNamesIn, type FileReference } from "./links.ts";

export const name = "context-reference";

export const inject = ["skills"];

// 用户显式引用的文件内容注入：`references` 按注入顺序列出这条消息里实际装了的引用（含行窗口）。
export interface FileReferenceSource {
  readonly kind: "file-reference";
  readonly references: readonly FileReference[];
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "file-reference": FileReferenceSource;
  }
}

export function apply(ctx: Context): void {
  ctx.on("agent/pre-step", async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next();
    if (decision.kind === "reject") return decision;
    // 依赖关系：没有对应工具时，注入也没有意义（模型拿到了内容也用不上那条路径）——
    // 文件引用要有 read 能力，skill 引用要有 skill 工具。是否注入跟着工具走。
    // 工具服务是可选的（`ctx.get` 在未声明 inject 的 ctx 上会抛，所以这里自己兜住）：
    // 没有它时不参与判断，按解析结果照常展开。
    const tools = ((): unknown => {
      try {
        return ctx.get("tools");
      } catch {
        return undefined;
      }
    })() as { get(name: string, agent: unknown): unknown } | undefined;
    const hasTool = (name: string): boolean =>
      tools === undefined || tools.get(name, agent) !== undefined;
    const hasRead = hasTool("read");
    const hasSkill = hasTool("skill");
    const names = hasSkill ? skillNamesIn(messages) : [];
    const files = hasRead ? fileReferencesIn(messages) : [];
    if (names.length === 0 && files.length === 0) return decision;
    signal.throwIfAborted();
    const cwd = agent.session.header.cwd;
    const injections: UserMessage[] = [];
    for (const name of names) {
      const skill = await ctx.skills.get(name, { cwd, signal, scope: agent });
      signal.throwIfAborted();

      if (skill === undefined || !isUserInvocable(skill)) continue;
      const source: SkillInvocationSource = {
        kind: "skill-invocation",
        name,
        form: "instructions",
      };
      injections.push(
        createUserMessage({
          content: [{ type: "text", text: renderSkillContent(skill) }],
          source,
        }),
      );
    }
    // `ctx.fs` 是可选能力：没有文件系统的部署里 skill 注入照常，文件引用保持普通文本。
    const fs = ctx.get("fs");
    const read: FileReference[] = [];
    const envelopes: ContentBlock[] = [];
    for (const reference of files) {
      const envelope =
        fs === undefined ? undefined : await readFileContent(fs, reference, { cwd, signal });
      signal.throwIfAborted();
      if (envelope === undefined) continue;
      read.push(reference);
      envelopes.push({ type: "text", text: envelope });
    }
    if (read.length > 0) {
      injections.push(
        createUserMessage({
          content: [...envelopes],
          source: { kind: "file-reference", references: read },
        }),
      );
    }
    if (injections.length === 0) return decision;
    return { ...decision, messages: [...decision.messages, ...injections] };
  });
}
