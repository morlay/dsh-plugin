// PTC 的 SDK 说明：**不**把全部工具铺成一个大 `ToolArgsMap`（那样工具一变、system 前缀就变）。
//
// - system 里只放稳定骨架：`interface ToolsSdk`（含 `describe_tool`）+ `declare const tools: ToolsSdk`；
// - 具体分组通过 `describe_tool({ group })` 现取现用（同一条 interface 的成员片段，多次 describe 合并）；
// - 工具增删只影响 describe 的结果，不改 system。
//
// 成员形态与键的判据归 `@morlay/dsh-tool-guidance/groups`：MCP 的工具名带 `-`，函数声明表达不了。
import {
  TOOLS_SDK_INTERFACE,
  renderToolKey,
  renderToolsDeclaration,
} from "@morlay/dsh-tool-guidance/groups";

// 一个工具在 SDK 文本里的最小信息（与上游 `ToolSdkSchema` 同形，这里只取要用的字段）。
export interface PtcToolSchema {
  readonly name: string;
  // 工具的一行说明（`dsh-tool-guidance` 维护的中文短描述）。
  readonly description: string;
  // 参数的 TypeScript 类型文本（已由调用方从 JSON Schema 转换好）。
  readonly args: string;
  // 输出的 TypeScript 类型文本。
  readonly output: string;
  // 该工具在 harness 里的说明 section（`tool:<name>`）：随 describe 一起返回，不占 system。
  readonly section?: string;
}

// 稳定的 system 骨架：所有具体工具都通过 describe 取，字节不随工具集变化。
// group 清单由当前可见工具的组现算，模型才知道有哪些组可取。
export function renderSkeleton(groups: readonly string[], members: readonly string[] = []): string {
  const list =
    groups.length === 0 ? "（当前没有可用的组）" : groups.map((g) => JSON.stringify(g)).join(" | ");
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

// 一段工具声明：参数与返回都内联成 TS 类型（各自由 JSON Schema 转换而来）。
export function renderTools(schemas: readonly PtcToolSchema[]): string {
  if (schemas.length === 0) return "";
  const sorted = [...schemas].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const declaration = renderToolsDeclaration(
    sorted.map((schema) => ({ name: schema.name, args: schema.args, output: schema.output })),
  );
  // 带引号的键只在有非常规名字时出现：多出来的那句提示也跟着出现，模型不用自己猜怎么调。
  const hint = sorted.some((schema) => renderToolKey(schema.name) !== schema.name)
    ? '名字带引号的成员用索引访问：`tools["名字"](args)`。\n\n'
    : "";
  // section 与工具组一一对应：先给说明，再给 `ts` 代码块里的 d.ts。
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
  if (group === undefined) {
    return [...groups.keys()].sort().join("\n");
  }
  const schemas = groups.get(group);
  if (schemas === undefined) return "";
  return renderTools(schemas);
}

// PTC 装配下把上游那份全量 `tools:sdk` 换成稳定骨架；别的 section 原样保留。
export function replaceToolsSdk<T extends { readonly name: string; readonly text: string }>(
  sections: readonly T[],
  skeleton: string,
): readonly T[] {
  return sections.map((section) =>
    section.name === "tools:sdk" ? { ...section, text: skeleton } : section,
  );
}
