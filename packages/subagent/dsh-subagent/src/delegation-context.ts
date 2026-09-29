// 汉化 `subagent:delegation`：上游在**子代理自己的 agent 作用域**上注册这条运行时上下文
// （`child-agent.ts` 的 `applyChildComposition`），于是两条常规接管手法都不通：
//
// - **同名遮蔽**：同一 scope 里重复注册同名 context 会抛错（`NamedEntries.insert` 报
//   `prompt context "subagent:delegation" is already registered in this scope`），而装配用的 scope 就是子代理自己
//   （`assembleContextFor(agent)` → `scope: agent`），与上游那次注册同层；
// - **fork `child-agent.ts`**：注册这条文本的两个调用方都在上游**未复制**的文件里——
//   `continuation-activation.ts` import 同目录的 `./child-agent.ts`，一次性路径的 `subagent-in-process-driver`
//   import 的是包名 `@deepseek-ai/dsh-subagent`——所以只改 fork 那份，真装配里读到的仍是上游英文。
//
// 这里改的是**装配结果**：`SystemPrompt.assemble()` 先 merge 好 contexts、再进 `system-prompt/assemble` 瀑布，本包
// 在瀑布里把该名字那条的文本换成中文。它在**该次**装配内生效（第一次装配就是中文），两条派发路径一起覆盖；父 agent
// 的装配不碰（这条本来只对子代理注册）。
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-system-prompt";

// 上游注册的运行时上下文名：同名才叫接管。
export const DELEGATION_CONTEXT_NAME = "subagent:delegation";

// 模型看到的委派范围说明：权限在创建时固定、需要审批的操作一律被拒，超出范围时说明限制而不是重试。
export const DELEGATION_CONTEXT_TEXT =
  "你是被派发的子代理：权限范围在创建时就固定，本会话内不能放宽——需要审批的操作一律被自动拒绝。\n" +
  "任务需要超出这个范围时不要重试被拒的操作，在回复里说明这个限制，让派发你的智能体处理。";

// 装配期替换那一条文本；子代理装配才动（`parentSession` 是委派出来的判据）。
export function installDelegationContext(ctx: Context): void {
  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const assembled = await next();
    if (context.agent?.session.header.parentSession === undefined) return assembled;
    return {
      ...assembled,
      contexts: assembled.contexts.map((entry) =>
        entry.name === DELEGATION_CONTEXT_NAME
          ? { ...entry, text: DELEGATION_CONTEXT_TEXT }
          : entry,
      ),
    };
  });
}
