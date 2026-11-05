// 工具的组归属与组引用：收口与面板读同一套（组表的 home 是 `./packs`）。
import { groupRef, refGroup } from "../endpoint/tool-group-ref.ts";
import { TOOL_GROUPS } from "./packs/index.ts";

// 组引用的两种写法是**两端共用**的值：定义在 `./endpoint`，这里转出给宿主半的消费方。
export { groupRef, refGroup };

const BY_KEY = new Map(TOOL_GROUPS.map((group) => [group.key, group]));
const BY_TOOL = new Map(
  TOOL_GROUPS.flatMap((group) => group.tools.map(({ tool }) => [tool, group.key] as const)),
);

// MCP 一个 server 一组（`mcp:<server>`），静态表覆盖不了，所以放在兜底那一支。
export function toolGroupOf(name: string): string {
  const known = BY_TOOL.get(name);
  if (known !== undefined) return known;
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const separator = rest.indexOf("__");
    if (separator > 0) return `mcp:${rest.slice(0, separator)}`;
  }
  return "other";
}

// 常驻组：这些组的工具默认就在目录里（对应 guidance 的 `injection: "init"`）。
export function isResidentToolGroup(group: string): boolean {
  if (group === "other") return true;
  if (group.startsWith("mcp:")) return false;
  return BY_KEY.get(group)?.injection !== "on-demand";
}

export function toolGroupLabel(group: string): string {
  if (group.startsWith("mcp:")) return `MCP · ${group.slice("mcp:".length)}`;
  return BY_KEY.get(group)?.title ?? "其它";
}

// 名单是否命中这个工具：写具体 id，或写它所属的组。
export function deniedByList(deny: readonly string[], id: string): boolean {
  const group = toolGroupOf(id);
  return deny.some(
    (ref) =>
      ref === id ||
      ((ref.startsWith("group:") || ref.startsWith("mcp:")) && refGroup(ref) === group),
  );
}

// 名字面 → 按需组名（`mcp:<server>` / `group:<id>`）→ 组内工具名（保持注册顺序）。
export function groupTools(names: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const group = toolGroupOf(name);
    if (isResidentToolGroup(group)) continue;
    const key = groupRef(group);
    const tools = groups.get(key);
    if (tools === undefined) groups.set(key, [name]);
    else tools.push(name);
  }
  return groups;
}

// PTC 的入口工具名：模型面收窄成一条时，正文的可见判据要给它豁免（它不在注册表里）。
export const RUN_CODE_NAME = "run_code";

// PTC 的信号：只有 PTC 执行器注册这条 section（装配期唯一能看到的证据）。
export const PTC_ONLY_SECTION = "tools:ptc-only";

// 不可被开关收窄的工具：`run_code` 是 PTC 的入口，`describe_tool` 是它取签名的手段。
export const PROTECTED_TOOLS: ReadonlySet<string> = new Set([RUN_CODE_NAME, "describe_tool"]);

export function isProtectedTool(name: string): boolean {
  return PROTECTED_TOOLS.has(name);
}
