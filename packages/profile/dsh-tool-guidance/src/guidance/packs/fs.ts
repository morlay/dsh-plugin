// 文件与目录：读写搜 + 工作目录。
import type { ToolGroup } from "../types.ts";

export const FS_GROUP: ToolGroup = {
  key: "fs",
  title: "文件",
  injection: "init",
  guideline: "「文件」这一组工具的用法；需要时加载它。",
  lines: [
    {
      when: "read",
      text: "read：读文本文件（严禁使用 sed/cat 之类的 shell 命令）；大文件用 offset/limit 续读。",
    },
    {
      when: "write",
      text: "write：创建文件或整体覆盖；已存在的文件先 read 再改，局部改动优先 edit。",
    },
    {
      when: "edit",
      text: "edit：按精确匹配替换；old_string 默认必须唯一，出现多次时给更长的上下文或 replace_all。",
    },
    {
      when: "apply_patch",
      text: "apply_patch：跨文件或分开的几处一起改时用它（Codex 风格补丁：`*** Begin Patch` … `*** End Patch`）；整份先校验、拒绝则什么都不改，开始应用后按序执行、遇错即停且不回滚——重试前先重读受影响的文件。",
    },
    {
      when: "str_replace_editor",
      text: "str_replace_editor：path 必须绝对路径、目录只能 view；str_replace 的 old_str 必须逐字且唯一（不唯一就不改），删除匹配要省略 new_str 而不是传 null。",
    },
    {
      when: "glob",
      text: "glob：按路径模式找文件（不要用 shell find）；不含斜杠的模式匹配任意深度的文件名，结果只有文件。",
    },
    {
      when: "grep",
      text: "grep：按内容搜索（不要用 shell grep / rg）；需要上下文再 read 命中的文件。",
    },
    {
      when: "working_directory",
      text: "working_directory：查会话当前工作目录，或传 cd 切到某个已存在的目录——切完相对路径都按它解析；已开的 shell 与在跑进程留在自己的目录里，不受这次切换影响。",
    },
    { when: "read_image", text: "read_image：看图。" },
  ],
  drops: [
    "tool:read",
    "tool:write",
    "tool:edit",
    "tool:apply_patch",
    "tool:glob",
    "tool:grep",
    "tool:jobs",
    "tool:pty",
  ],
  tools: [
    { tool: "read", short: "读文件内容（可指定行范围）" },
    { tool: "write", short: "写入文件或整文件覆盖" },
    { tool: "edit", short: "按精确匹配替换文件片段" },
    { tool: "apply_patch", short: "用一个补丁批量增删改移多个文件" },
    { tool: "glob", short: "按模式查找文件路径" },
    { tool: "grep", short: "按正则搜索文件内容" },
    { tool: "working_directory", short: "查看当前工作目录，或用 cd 切换" },
    { tool: "read_image", short: "读取图片内容" },
    { tool: "str_replace_editor", short: "查看 / 创建 / 精确替换文件" },
  ],
};
