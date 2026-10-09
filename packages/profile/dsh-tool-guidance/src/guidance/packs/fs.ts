// 文件与目录：读写搜 + 工作目录。
import type { ToolPack } from "../types.ts";

export const FS_PACK: ToolPack = {
  family: "fs",
  tools: [
    { tool: "read", short: "读文件内容（可指定行范围）" },
    { tool: "write", short: "写入文件或整文件覆盖" },
    { tool: "edit", short: "按精确匹配替换文件片段" },
    { tool: "glob", short: "按模式查找文件路径" },
    { tool: "grep", short: "按正则搜索文件内容" },
    { tool: "working_directory", short: "查看当前工作目录，或用 cd 切换" },
    { tool: "read_image", short: "读取图片内容" },
    { tool: "str_replace_editor", short: "查看 / 创建 / 精确替换文件" },
  ],
};
