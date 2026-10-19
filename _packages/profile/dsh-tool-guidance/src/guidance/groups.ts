// 用法组：**数据在 `packs/group-*.ts`，这份文件只做汇总与渲染**（组名、成员、正文、丢弃清单各归一份 pack）。
// 分组不设门控——组只决定"用法说明怎么分批送达"：`base` 由本行常驻注入，其余注册进官方 skill 目录、按需加载。
import { GROUP_PACKS, groupsOf, shortDescriptionsOf, TOOL_PACKS } from "./packs/index.ts";
import type { GroupKey, ToolGroup } from "./types.ts";

export type { GroupKey, GroupLine, ToolGroup } from "./types.ts";
export { BASE_GROUP_KEY, GROUP_KEYS, skillNameOf } from "./types.ts";

// 组表：由 `packs/group-*.ts` 汇总（重 key 在汇总时抛错）。
export const TOOL_GROUPS: readonly ToolGroup[] = groupsOf(GROUP_PACKS);

// 工具名 → 一行中文：由各族的数据包汇总；加一个工具 = 改它所属的族文件（重名在汇总时抛错）。
export const SHORT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> =
  shortDescriptionsOf(TOOL_PACKS);

export function groupByKey(key: GroupKey): ToolGroup {
  const group = TOOL_GROUPS.find((entry) => entry.key === key);
  if (group === undefined) throw new Error(`tool-guidance: unknown group "${key}"`);
  return group;
}

// 某个组 skill 的正文：markdown 列表，一行一条，模型扫一眼就知道怎么用。
// 上游原文不拼进来——要点已经吸收在这些中文行里。
// `visible` 是"这一行依赖的工具在不在"的判据：`base` 的常驻注入传**这个会话装配结果里最终可见的工具目录**
// （收窄掉的工具不在里面；读不到目录时的兜底见 [`index.ts` 的 `registeredIn`](../index.ts)），按需注册的那三组
// 在装配期定型，不传即全量。
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
