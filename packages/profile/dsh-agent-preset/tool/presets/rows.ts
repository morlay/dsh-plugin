/**
 * 本包只留**提示词与能力开关**：功能行清单的真源在 [`@morlay/dsh-agent-toolkit/rows`](../../../dsh-agent-toolkit/src/rows.ts)，
 * 注入通道那份在 [`@morlay/dsh-context-assembler/rows`](../../../../context/dsh-context-assembler/src/rows.ts)。
 * 这里只把两者转出来，各模式的清单（`standard.ts` / `chat.ts`）组合它们。
 *
 * 两个包都同时是 bundle：直接列进 `dsh.profile.bundles` 时行装在 host 平面（对所有 preset 生效），
 * 由 preset 引用时行住进该 preset 的 `isolate` 组。本包走的是后者。
 */
export { agentTeamRows } from "@morlay/dsh-agent-toolkit/agent-team";
export {
  AGENT_TEAM_ENV,
  group,
  guidanceRow,
  row,
  SHELL_ROWS,
  TOOLKIT_ROWS,
  CHAT_TOOLKIT_ROWS,
  type PresetRow,
  type RowExtra,
} from "@morlay/dsh-agent-toolkit/rows";
export {
  channelGroup,
  CONTEXT_CHANNEL_GROUP_ID as CHANNEL_GROUP_ID,
  contextChannel,
} from "@morlay/dsh-context-assembler/rows";
