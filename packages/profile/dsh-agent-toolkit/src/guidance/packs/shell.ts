/** shell 与后台任务。 */
import type { ToolPack } from "../types.ts";

export const SHELL_PACK: ToolPack = {
  family: "shell",
  tools: [
    { tool: "bash", short: "执行 shell 命令" },
    { tool: "pwsh", short: "执行 PowerShell 命令" },
    { tool: "job_output", short: "读取后台任务的输出" },
    { tool: "job_list", short: "列出后台任务" },
    { tool: "job_kill", short: "终止后台任务" },
  ],
};
