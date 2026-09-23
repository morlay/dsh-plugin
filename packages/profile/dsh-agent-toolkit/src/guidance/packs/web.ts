/** 联网。 */
import type { ToolPack } from "../types.ts";

export const WEB_PACK: ToolPack = {
  family: "web",
  tools: [
  { tool: "web_fetch", short: "抓取指定 URL 的内容" },
  { tool: "web_search", short: "联网搜索" },
  ],
};
