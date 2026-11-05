// MCP 资源：只有 server 宣告了 resources 才有这三件。
import type { ToolGroup } from "../types.ts";

export const MCP_GROUP: ToolGroup = {
  key: "mcp",
  title: "MCP 资源",
  injection: "on-demand",
  guideline: "要读某个 MCP server 暴露的只读资源（文档 / 日志 / 数据）时加载它。",
  lines: [
    {
      when: ["list_mcp_resources", "list_mcp_resource_templates"],
      text: "先 list 再 read：`list_mcp_resources` 给静态资源，`list_mcp_resource_templates` 给带参数的模板（如 `logs://{date}`）。",
    },
    {
      when: "read_mcp_resource",
      text: "`read_mcp_resource` 按 URI 取内容；server 没有宣告 resources 时列表为空，不要反复重试。",
    },
  ],
  drops: ["mcp-resource-servers"],
  tools: [
    { tool: "list_mcp_resources", short: "列出某个 MCP server 暴露的资源" },
    { tool: "list_mcp_resource_templates", short: "列出某个 MCP server 的资源模板" },
    { tool: "read_mcp_resource", short: "按 URI 读取 MCP 资源内容" },
  ],
};
