// 委派范围说明（运行时上下文 `subagent:delegation`）的中文那条。
//
// 上游把它注册在**子代理自己的 agent 作用域**上，同层重复注册同名 context 会抛错
// （`NamedEntries.insert`），所以改的是装配结果：`system-prompt/assemble` 瀑布里换文本，
// 只对子代理的装配动手，且在该次装配内生效。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { AssembledContext } from "@morlay/dsh-agent/contract";

// 上游注册的上下文名：同名才叫接管。
export const DELEGATION_CONTEXT_NAME = "subagent:delegation";

// 中文那条：权限在创建时固定、需要审批的操作一律被拒，超出范围时说明限制而不是重试。
export const DELEGATION_CONTEXT_TEXT =
  "你是被派发的子代理：权限范围在创建时就固定，本会话内不能放宽——需要审批的操作一律被自动拒绝。\n" +
  "任务需要超出这个范围时不要重试被拒的操作，在回复里说明这个限制，让派发你的智能体处理。";

// 这次装配是不是子代理的：`parentSession` 是委派出来的判据。
export function isDelegatedAgent(agent: Agent | undefined): boolean {
  return agent?.session.header.parentSession !== undefined;
}

// 一条上下文条目要不要换成中文：名字对上才换，其余原样。
export function rewordedContext(entry: AssembledContext): AssembledContext {
  return entry.name === DELEGATION_CONTEXT_NAME
    ? { ...entry, text: DELEGATION_CONTEXT_TEXT }
    : entry;
}
