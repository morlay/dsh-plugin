// 工具组：**数据在 `packs/*.ts`，这份文件只做汇总与渲染**（组名、成员、正文、丢弃清单各归一份 pack）。
// 组只决定"用法说明怎么分批送达"：`injection: "init"` 由本行常驻注入，`on-demand` 注册进官方 skill 目录。
import { shortDescriptionsOf, TOOL_GROUPS as GROUPS } from "./packs/index.ts";
import type { ToolGroup } from "./types.ts";

export type { GroupLine, ToolGroup, ToolGuidance } from "./types.ts";
export { skillNameOf } from "./types.ts";

export const TOOL_GROUPS: readonly ToolGroup[] = GROUPS;

// 工具名 → 一行中文：由各组的数据汇总（重名在 `assertGroupsUnique` 里抛错）。
export const SHORT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> =
  shortDescriptionsOf(TOOL_GROUPS);

export function groupByKey(key: string): ToolGroup {
  const group = TOOL_GROUPS.find((entry) => entry.key === key);
  if (group === undefined) throw new Error(`tool-guidance: unknown group "${key}"`);
  return group;
}

// 某个组的正文：markdown 列表，一行一条。
// `visible` 是"这一行依赖的工具在不在"的判据：`base` 的常驻注入传**这个会话装配结果里最终可见的工具目录**。
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

// 工具名 → 组 key（工具组是这份表的唯一 home，别处不再重复声明一套）。
export function groupOfTool(name: string): string | undefined {
  return TOOL_GROUPS.find((group) => group.tools.some((entry) => entry.tool === name))?.key;
}

// 组 key → 显示名。
export function groupTitleOf(key: string): string | undefined {
  return TOOL_GROUPS.find((group) => group.key === key)?.title;
}

// 工具成员在 d.ts 里的最小形状：调用签名 + 可选的一行说明。
export interface ToolSignature {
  readonly name: string;
  readonly args: string;
  readonly output: string;
  readonly doc?: string;
}

// 成员容器的名字：PTC 骨架与这里注入的组签名都写它，模型看到的才是同一个 `tools`。
export const TOOLS_SDK_INTERFACE = "ToolsSdk";

// 工具名 → `tools` 上的成员键：合法标识符裸写，其余（MCP 的 `-`）加引号。
export function renderToolKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
}

// 一组成员的调用签名块：键能裸写就裸写，不能的加引号（`tools["名字"](args)` 同样成立）。
export function renderToolsDeclaration(signatures: readonly ToolSignature[]): string {
  const members = signatures.flatMap((signature) => [
    ...(signature.doc === undefined ? [] : [`    /** ${signature.doc} */`]),
    `    ${renderToolKey(signature.name)}(args: ${signature.args}): Promise<${signature.output}>`,
  ]);
  return ["declare global {", `  interface ${TOOLS_SDK_INTERFACE} {`, ...members, "  }", "}"].join(
    "\n",
  );
}
