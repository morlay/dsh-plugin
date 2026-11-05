// Shell 与后台任务。
import type { ToolGroup } from "../types.ts";

export const SHELL_GROUP: ToolGroup = {
  key: "shell",
  title: "Shell",
  injection: "init",
  guideline: "要执行命令（构建、测试、git、包管理、脚本）时用它；不要拿它替代文件编辑。",
  lines: [
    {
      when: "bash",
      text: "bash：**只用于真正需要命令行的场景**（构建、测试、git、包管理、脚本）；读/写/改文件用 read/write/edit，找文件用 glob，搜内容用 grep，抓网页用 web_fetch——不要拿 bash 代替它们。使用参数 workdir（默认你的工作目录），严禁 `cd`；前台调用是**一次性返回**（不流式），非零退出会标 [exit code: N]，先查清失败原因再继续。",
    },
    {
      when: ["job_output", "job_list", "job_kill"],
      text: "后台任务：长跑或要看增量输出时用 `run_in_background` 启动并记下 job id（前台 bash 不流式，只能等它跑完）；完成会主动通知，不要轮询，用 job_output 读已有输出（可反复读增量），不再需要的用 job_kill。",
    },
    {
      when: "terminal_open",
      text: "terminal_open：只有需要跨调用存活的 shell / REPL 状态或交互式 stdin 时才开持久终端（cwd 省略是工作区根）；一次性有界操作用 bash。",
    },
    {
      when: "terminal_send",
      text: "terminal_send：默认补回车再等结果（控制字符或不完整 REPL 输入要 submit=false）；inferred_idle 与 timeout 都不代表前台命令已退出。",
    },
    {
      when: ["terminal_read", "terminal_signal", "terminal_close", "terminal_list"],
      text: "终端会话要记 id 并收尾：terminal_read 只读保留输出，terminal_signal 只送 SIGINT / SIGTERM / SIGTSTP / SIGHUP（SIGKILL 会被拒，改用 terminal_close），terminal_list 看名下还有哪些。",
    },
  ],
  drops: ["tool:bash", "tool:pwsh"],
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
