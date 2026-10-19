// shell 与后台任务。
import type { ToolPack } from "../types.ts";

export const SHELL_PACK: ToolPack = {
  family: "shell",
  tools: [
    { tool: "bash", short: "执行 shell 命令" },
    { tool: "pwsh", short: "执行 PowerShell 命令" },
    { tool: "job_output", short: "读取后台任务的输出" },
    { tool: "job_list", short: "列出后台任务" },
    { tool: "job_kill", short: "终止后台任务" },
    { tool: "terminal_open", short: "开一个持久终端会话" },
    { tool: "terminal_send", short: "向终端送入输入并等待" },
    { tool: "terminal_read", short: "读终端保留的输出" },
    { tool: "terminal_signal", short: "给终端前台进程发信号" },
    { tool: "terminal_close", short: "关闭终端会话" },
    { tool: "terminal_list", short: "列出名下的终端会话" },
  ],
};
