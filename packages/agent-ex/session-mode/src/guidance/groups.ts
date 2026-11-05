// 工具组：数据在 `packs/*.ts`，这份文件只做汇总与渲染。
//
// 组只决定"用法说明怎么分批送达"：`injection: "init"` 常驻注入，`on-demand` 注册进技能目录。
import { shortDescriptionsOf, TOOL_GROUPS as GROUPS } from "./packs/index.ts";
import type { ToolGroup } from "./types.ts";

export type { GroupLine, ToolGroup, ToolGuidance } from "./types.ts";
export { skillNameOf } from "./types.ts";
// 组表的重名检查（装配期 fail loud）：数据在 `packs/**`，判据由它自己给。
export { assertGroupsUnique } from "./packs/index.ts";

export const TOOL_GROUPS: readonly ToolGroup[] = GROUPS;

// 工具名 → 一行中文：由各组的数据汇总（重名在 `assertGroupsUnique` 里抛错）。
export const SHORT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> =
  shortDescriptionsOf(TOOL_GROUPS);

export function groupByKey(key: string): ToolGroup {
  const group = TOOL_GROUPS.find((entry) => entry.key === key);
  if (group === undefined) throw new Error(`tool-guidance: unknown group "${key}"`);
  return group;
}

// 某个组的正文：markdown 列表，一行一条。`visible` 是"这一行依赖的工具在不在"的判据。
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

// 工具名 → 组 key（工具组是这份表的唯一 home）。
export function groupOfTool(name: string): string | undefined {
  return TOOL_GROUPS.find((group) => group.tools.some((entry) => entry.tool === name))?.key;
}

// 组 key → 完整描述（`describe_tool` 用它，取代了「每组注册一个 skill」那套）。
//
// 动态组（`mcp:<server>`）回落到 `mcp` 那一份：每个 server 的工具不同，但「怎么读资源」是同一件事。
export interface GroupDescriptor {
  readonly title: string;
  // 什么时候该看这一组（`describe_tool` 不带参数时逐行渲染它）。
  readonly guideline: string;
  // 用法正文（带参数时给）。
  readonly body: string;
}

export function groupDescriptorOf(key: string): GroupDescriptor | undefined {
  const isMcp = key.startsWith("mcp:");
  const group = TOOL_GROUPS.find((candidate) => candidate.key === (isMcp ? "mcp" : key));
  if (group === undefined) return undefined;
  return {
    // 动态组的标题要带上 server 名，否则清单里一排 "MCP 资源" 分不清是哪个 server。
    title: isMcp ? `MCP · ${key.slice("mcp:".length)}` : group.title,
    guideline: group.guideline,
    body: groupSkillBody(group),
  };
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

// 成员容器的名字：PTC 骨架与组签名都写它，模型看到的才是同一个 `tools`。
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
