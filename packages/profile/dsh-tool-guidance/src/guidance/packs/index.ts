// 组索引：**加一个工具组 = 加一份文件 + 在这里登一行**。key 与工具名都做重名检查，撞了就 fail loud。
import type { ToolGroup } from "../types.ts";
import { ASK_GROUP } from "./ask.ts";
import { CODE_GROUP } from "./code.ts";
import { FS_GROUP } from "./fs.ts";
import { MCP_GROUP } from "./mcp.ts";
import { PLAN_GROUP } from "./plan.ts";
import { SHELL_GROUP } from "./shell.ts";
import { SKILL_GROUP } from "./skill.ts";
import { SWARM_GROUP } from "./swarm.ts";
import { WEB_ACCESS_GROUP } from "./web-access.ts";

export type { GroupLine, ToolGroup, ToolGuidance } from "../types.ts";

// 全部工具组（顺序只影响报错信息里的排列）。
export const TOOL_GROUPS: readonly ToolGroup[] = [
  FS_GROUP,
  SHELL_GROUP,
  WEB_ACCESS_GROUP,
  CODE_GROUP,
  ASK_GROUP,
  SKILL_GROUP,
  PLAN_GROUP,
  SWARM_GROUP,
  MCP_GROUP,
];

// 重名检查：组 key 唯一、工具名跨组唯一。
export function assertGroupsUnique(groups: readonly ToolGroup[] = TOOL_GROUPS): void {
  const keys = new Set<string>();
  const tools = new Map<string, string>();
  for (const group of groups) {
    if (keys.has(group.key)) throw new Error(`tool-guidance: duplicate group key "${group.key}"`);
    keys.add(group.key);
    for (const { tool } of group.tools) {
      const owner = tools.get(tool);
      if (owner !== undefined && owner !== group.key) {
        throw new Error(`tool-guidance: tool "${tool}" appears in "${owner}" and "${group.key}"`);
      }
      tools.set(tool, group.key);
    }
  }
}

// 工具名 → 一行中文。
export function shortDescriptionsOf(
  groups: readonly ToolGroup[] = TOOL_GROUPS,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    groups.flatMap((group) => group.tools.map(({ tool, short }) => [tool, short])),
  );
}
