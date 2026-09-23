/**
 * pack 索引：**加一个工具族或一个用法组 = 加一份文件 + 在这里登一行**。
 *
 * 两类 pack 同一套形态（见 [`../types.ts`](../types.ts)）：
 *
 * - **工具族**（`fs` / `shell` / `web` / …）：一组工具的一行中文，`shortDescriptionsOf()` 汇总成表；
 * - **用法组**（`group-base` / `group-flow` / …）：一段用法正文与它的注入方式，`groupsOf()` 汇总成组表。
 *
 * 两处都做重名检查：同一个工具名出现在两个族里、或两个 pack 声明同一个组 key 时 fail loud——
 * 那说明归类/命名错了，而不是"后者覆盖前者"。
 */
import type { GroupPack, ToolGroup, ToolPack } from "../types.ts";
import { ASK_PACK } from "./ask.ts";
import { DELEGATION_PACK } from "./delegation.ts";
import { FLOW_PACK } from "./flow.ts";
import { FS_PACK } from "./fs.ts";
import { SHELL_PACK } from "./shell.ts";
import { SKILL_PACK } from "./skill.ts";
import { TEAM_PACK } from "./team.ts";
import { WEB_PACK } from "./web.ts";
import { BASE_GROUP } from "./group-base.ts";
import { DELEGATION_GROUP } from "./group-delegation.ts";
import { FLOW_GROUP } from "./group-flow.ts";
import { TEAM_GROUP } from "./group-team.ts";

export type { GroupPack, ToolGuidance, ToolPack } from "../types.ts";

/** 全部工具族（顺序只影响报错信息里的排列）。 */
export const TOOL_PACKS: readonly ToolPack[] = [
  ASK_PACK,
  DELEGATION_PACK,
  FLOW_PACK,
  FS_PACK,
  SHELL_PACK,
  SKILL_PACK,
  TEAM_PACK,
  WEB_PACK,
];

/** 全部用法组（顺序按组 key 的既有排列）。 */
export const GROUP_PACKS: readonly GroupPack[] = [
  BASE_GROUP,
  FLOW_GROUP,
  DELEGATION_GROUP,
  TEAM_GROUP,
];

/**
 * 合成"工具名 → 一行中文"的表。
 * @param packs - 待合并的族，缺省全部。
 * @returns 冻结的表；同名工具出现在两个族里时抛错。
 */
export function shortDescriptionsOf(
  packs: readonly ToolPack[] = TOOL_PACKS,
): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {};
  const owner = new Map<string, string>();
  for (const pack of packs) {
    for (const guidance of pack.tools) {
      const seen = owner.get(guidance.tool);
      if (seen !== undefined) {
        throw new Error(
          `tool-guidance: "${guidance.tool}" 同时出现在族 "${seen}" 与 "${pack.family}" 里`,
        );
      }
      owner.set(guidance.tool, pack.family);
      merged[guidance.tool] = guidance.short;
    }
  }
  return merged;
}

/**
 * 工具名的并集：**工具集与汉化同源**——需要"这套工具有哪些"的地方（例如模式的 `allowTools` 白名单）读它，
 * 而不是另写一份名单。
 * @param packs - 待合并的族，缺省全部。
 * @returns 去重后的工具名（按族出现顺序）。
 */
export function toolNamesOf(packs: readonly ToolPack[] = TOOL_PACKS): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const guidance of pack.tools) {
      if (seen.has(guidance.tool)) continue;
      seen.add(guidance.tool);
      names.push(guidance.tool);
    }
  }
  return names;
}

/**
 * 汇总用法组。
 * @param packs - 待合并的组 pack，缺省全部。
 * @returns 组表；两个 pack 声明同一个 key 时抛错。
 */
export function groupsOf(packs: readonly GroupPack[] = GROUP_PACKS): readonly ToolGroup[] {
  const seen = new Map<string, string>();
  const groups: ToolGroup[] = [];
  for (const pack of packs) {
    const dupe = seen.get(pack.group.key);
    if (dupe !== undefined) {
      throw new Error(
        `tool-guidance: 组 "${pack.group.key}" 同时出现在 "${dupe}" 与 "${pack.family}" 里`,
      );
    }
    seen.set(pack.group.key, pack.family);
    groups.push(pack.group);
  }
  return groups;
}
