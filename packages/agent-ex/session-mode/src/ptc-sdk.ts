// PTC 的 SDK 说明：**不**把全部工具铺成一张大表（工具一变、system 前缀就变）。
//
// - system 里只放稳定骨架：`interface ToolsSdk`（含 `describe_tool`）+ `declare const tools: ToolsSdk`；
// - 具体分组通过 `describe_tool({ group })` 现取（同一条 interface 的成员片段，多次 describe 合并）。
import { TOOLS_SDK_INTERFACE, renderToolKey, renderToolsDeclaration } from "./guidance/groups.ts";
import { isResidentToolGroup, toolGroupOf } from "./guidance/tool-groups.ts";

// 一个工具在 SDK 文本里的最小信息。
export interface PtcToolSchema {
  readonly name: string;
  readonly description: string;
  // 参数的 TypeScript 类型文本（已由调用方从 JSON Schema 转换好）。
  readonly args: string;
  // 输出的 TypeScript 类型文本。
  readonly output: string;
  // 该工具在 harness 里的说明 section（`tool:<name>`）：随 describe 一起返回，不占 system。
  readonly section?: string;
}

// 稳定的 system 骨架：所有具体工具都通过 describe 取，字节不随工具集变化。
export function renderSkeleton(groups: readonly string[], members: readonly string[] = []): string {
  const list =
    groups.length === 0
      ? "（当前没有可用的组）"
      : groups.map((group) => JSON.stringify(group)).join(" | ");
  return [
    '在 `run_code` 写的程序里调用工具：`await tools.name(args)`；名字带引号的成员用索引访问（`tools["名字"](args)`）。**常驻组**的签名已列在下面；其余组用 `describe_tool({ group })` 现取（不带 `group` 返回分组清单）：',
    "",
    "```ts",
    "declare global {",
    `  interface ${TOOLS_SDK_INTERFACE} {`,
    ...members,
    `    describe_tool(args: { group?: ${list} }): Promise<{ text?: string }>`,
    "  }",
    `  const tools: ${TOOLS_SDK_INTERFACE}`,
    "}",
    "```",
  ].join("\n");
}

export const PTC_SDK_SKELETON = renderSkeleton([]);

// 一段工具声明：参数与返回都内联成 TS 类型。
export function renderTools(schemas: readonly PtcToolSchema[]): string {
  if (schemas.length === 0) return "";
  const sorted = [...schemas].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const declaration = renderToolsDeclaration(
    sorted.map((schema) => ({ name: schema.name, args: schema.args, output: schema.output })),
  );
  const hint = sorted.some((schema) => renderToolKey(schema.name) !== schema.name)
    ? '名字带引号的成员用索引访问：`tools["名字"](args)`。\n\n'
    : "";
  const sections = schemas
    .map((schema) => schema.section?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
  const lead = sections.length === 0 ? "" : `${sections}\n\n`;
  return `${lead}${hint}${["```ts", declaration, "```"].join("\n")}`;
}

// `describe_tool()` 的结果：不带参数返回分组清单，带参数返回该组的声明片段。
export function renderDescribe(
  groups: ReadonlyMap<string, readonly PtcToolSchema[]>,
  group?: string,
): string {
  if (group === undefined) return [...groups.keys()].sort().join("\n");
  return renderTools(groups.get(group) ?? []);
}

// PTC 生效时把上游那份全量 `tools:sdk` 换成稳定骨架；别的 section 原样保留。
export function replaceToolsSdk<T extends { readonly name: string; readonly text: string }>(
  sections: readonly T[],
  skeleton: string,
): readonly T[] {
  return sections.map((section) =>
    section.name === "tools:sdk" ? { ...section, text: skeleton } : section,
  );
}

// system 骨架的正文：group 清单由当前可见工具现算（模型才知道有哪些组可取）。
export function ptcSdkText(visible: readonly string[]): string {
  return renderSkeleton([...new Set(visible.map((name) => toolGroupOf(name)))].sort());
}

// 一次 PTC 装配对本步 section 的改写：换掉 `tools:sdk`，丢掉按需组的工具说明（它们随 describe 回）。
export function ptcSections<T extends { readonly name: string; readonly text: string }>(
  sections: readonly T[],
  visible: readonly string[],
): readonly T[] {
  const keep = (name: string): boolean => {
    if (!name.startsWith("tool:")) return true;
    const tool = name.slice("tool:".length);
    // 常驻组的说明留在 system；按需组与不可见的工具由 describe 现取。
    if (!visible.includes(tool)) return false;
    return isResidentToolGroup(toolGroupOf(tool));
  };
  return replaceToolsSdk(
    sections.filter((section) => keep(section.name)),
    ptcSdkText(visible),
  );
}
