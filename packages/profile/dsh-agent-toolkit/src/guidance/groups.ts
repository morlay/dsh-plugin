/**
 * 用法组：**数据在 [`packs/group-*.ts`](./packs/index.ts)，这份文件只做汇总与渲染**（组名、成员、正文、
 * 注入方式、丢弃清单各归一份 pack；加一个组 = 加一份文件 + 在索引里登一行）。
 *
 * 分组不设门控：所有工具始终可用，组只决定"用法说明怎么分批送达"——`base` 常驻，其余按需加载。
 */
import { GROUP_PACKS, groupsOf, shortDescriptionsOf, TOOL_PACKS } from "./packs/index.ts";
import type { GroupKey, ToolGroup } from "./types.ts";

export type { GroupKey, GroupLine, ToolGroup } from "./types.ts";
export { BASE_GROUP_KEY, GROUP_KEYS, skillNameOf } from "./types.ts";

/** 组表：由 `packs/group-*.ts` 汇总（重 key 在汇总时抛错）。 */
export const TOOL_GROUPS: readonly ToolGroup[] = groupsOf(GROUP_PACKS);

/**
 * 工具名 → 一行中文：由各族的数据包汇总（见 [`packs/`](./packs/index.ts)）。
 *
 * 加一个工具 = 改它所属的族文件；同一个工具名出现在两个族里会在汇总时抛错。
 */
export const SHORT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> =
  shortDescriptionsOf(TOOL_PACKS);

export function groupByKey(key: GroupKey): ToolGroup {
  const group = TOOL_GROUPS.find((entry) => entry.key === key);
  if (group === undefined) throw new Error(`tool-guidance: unknown group "${key}"`);
  return group;
}

/**
 * 某个组 skill 的正文：markdown 列表，一行一条，模型扫一眼就知道怎么用。
 * 上游原文不拼进来——要点已经吸收在这些中文行里。
 */
export function groupSkillBody(
  group: ToolGroup,
  visible: (tool: string) => boolean = () => true,
): string {
  return group.lines
    .filter((line) => {
      const when = line.when;
      if (when === undefined) return true;
      return typeof when === "string" ? visible(when) : when.some(visible);
    })
    .map((line) => `- ${line.text}`)
    .join("\n");
}
