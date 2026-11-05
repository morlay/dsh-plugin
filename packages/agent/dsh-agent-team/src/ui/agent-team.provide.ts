import { provide } from "@morlay/zephyr";
import { AgentTeamUi } from "./agent-team.ui.ts";

// 浏览器半：团队动作（`conversation.session.header.actions`）与它的字典。
// 它要 `sessions` / `uiWorkspace` / `slots` / `locale` 就位，所以排在会话界面与工作区之后。
export const provideAgentTeamUi = provide([AgentTeamUi]);
