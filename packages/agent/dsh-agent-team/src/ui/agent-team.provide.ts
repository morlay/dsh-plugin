import { provide } from "@morlay/zephyr";
import { AgentTeamUi } from "./agent-team.ui.ts";

// 浏览器半：团队动作（`conversation.session.header.actions`）、字典，以及模型菜单里的
// 「启用智能体团队协作」开关。它要 `slots` / `locale` / `remote` 就位，所以排在会话界面之后。
export const provideAgentTeamUi = provide([AgentTeamUi]);
