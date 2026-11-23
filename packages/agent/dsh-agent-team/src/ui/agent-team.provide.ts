import { provide } from "@morlay/zephyr";
import { AgentTeamUi } from "./agent-team.ui.ts";

// 浏览器半：团队命令行（`conversation.chat.commandview`）、会话面板里的共享任务一节
// （`conversation.session.panel.section` 的 `shared-tasks`）、字典，以及模型菜单里的
// 「启用智能体团队协作」开关（`conversation.input.model.options`）。位置都由上游 0.2.3 的行自己注册；
// 它要 `slots` / `locale` / `remote` 就位，所以排在会话界面之后。
export const provideAgentTeamUi = provide([AgentTeamUi]);
