import type { Context } from "@deepseek-ai/cordis";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-fs";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-session";
import {
  isUserInvocable,
  renderSkillContent,
  type SkillInvocationSource,
} from "@deepseek-ai/dsh-skill";
import { readFileContent } from "./file-content.ts";
import { fileReferencesIn, skillNamesIn } from "./links.ts";

export const name = "reference-injection";

export const inject = ["skills"];

// 用户显式引用的文件内容注入：`path` 指出引用的是哪个文件，行号窗口照引用原样记录。
export interface FileReferenceSource {
  readonly kind: "file-reference";
  readonly path: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "file-reference": FileReferenceSource;
  }
}

// 注入消息的第一块：先说清这是什么，模型才不会再去读一遍同一段内容。窗口被截断时要续读的情形
// 写在提醒里（footer 的续读提示仍在信封内）。
const FILE_CONTENT_REMINDER =
  "<system-reminder>下面是本步刚读取的最新文件内容，可直接使用；同一范围不必再用 read 工具重复读取，需要窗口之外的行时才续读。</system-reminder>";

export function apply(ctx: Context): void {
  ctx.on("agent/pre-step", async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next();
    if (decision.kind === "reject") return decision;
    const names = skillNamesIn(messages);
    const files = fileReferencesIn(messages);
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
    for (const reference of files) {
      const envelope =
        fs === undefined ? undefined : await readFileContent(fs, reference, { cwd, signal });
      signal.throwIfAborted();
      if (envelope === undefined) continue;
      const source: FileReferenceSource = {
        kind: "file-reference",
        path: reference.path,
        ...(reference.lineStart === undefined ? {} : { lineStart: reference.lineStart }),
        ...(reference.lineEnd === undefined ? {} : { lineEnd: reference.lineEnd }),
      };
      injections.push(
        createUserMessage({
          content: [
            { type: "text", text: FILE_CONTENT_REMINDER },
            { type: "text", text: envelope },
          ],
          source,
        }),
      );
    }
    if (injections.length === 0) return decision;
    return { ...decision, messages: [...decision.messages, ...injections] };
  });
}
