import { provide } from "@morlay/zephyr";
import { AgentBrowserUse } from "./agent-browser-use.service.ts";
import { AgentDesktopUse } from "./agent-desktop-use.service.ts";

// 浏览器与桌面操作：两条 MCP 客户端行。
//
// 命令只写全局 bin 名（`agent-browser` / `agent-desktop`），装没装由 PATH 决定；上游默认的
// `failOnStartupError: false` 让缺 bin 时这一行照常激活、只是没有工具。
export const provideAgentUse = provide([AgentBrowserUse, AgentDesktopUse]);
