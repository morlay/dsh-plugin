/** 文件与图片：读写搜。 */
import type { ToolPack } from "../types.ts";

export const FS_PACK: ToolPack = {
  family: "fs",
  tools: [
  { tool: "read", short: "读文件内容（可指定行范围）" },
  { tool: "write", short: "写入文件或整文件覆盖" },
  { tool: "edit", short: "按精确匹配替换文件片段" },
  { tool: "glob", short: "按模式查找文件路径" },
  { tool: "grep", short: "按正则搜索文件内容" },
  { tool: "read_image", short: "读取图片内容" },
  ],
};
