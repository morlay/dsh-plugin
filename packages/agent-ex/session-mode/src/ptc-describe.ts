// `describe_tool`：PTC 程序里现取某组工具的 d.ts（不把全量签名塞进 system）。
import { jsonSchemaToTs } from "@morlay/dsh-ptc/contract";
import { SHORT_TOOL_DESCRIPTIONS, type GroupDescriptor } from "./guidance/groups.ts";
import { toolGroupOf } from "./guidance/tool-groups.ts";
import { renderTools, type PtcToolSchema } from "./ptc-sdk.ts";

// 一条工具的静态描述（描述文本 + 宽松的 args/output 类型）。
export interface DescribeEntry {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema?: unknown;
  readonly outputSchema?: unknown;
}

// 按工具组分组；组名与面板上的分组一致（`mcp:agent-browser` 等）。
export function groupEntries(entries: readonly DescribeEntry[]): Map<string, PtcToolSchema[]> {
  const groups = new Map<string, PtcToolSchema[]>();
  for (const entry of entries) {
    const group = toolGroupOf(entry.name);
    const schema: PtcToolSchema = {
      name: entry.name,
      description: SHORT_TOOL_DESCRIPTIONS[entry.name] ?? entry.description,
      args: schemaText(entry.parametersSchema),
      output: schemaText(entry.outputSchema),
    };
    const list = groups.get(group);
    if (list === undefined) groups.set(group, [schema]);
    else list.push(schema);
  }
  return groups;
}

// 输出 schema → TS；转不了就是 `unknown`（`jsonSchemaToTs` 自己兜底）。
function schemaText(schema: unknown): string {
  return schema === undefined ? "JsonValue" : jsonSchemaToTs(schema);
}

const GROUP_SUMMARY: Readonly<Record<string, string>> = {
  fs: "文件读写",
  shell: "执行命令",
  "web-access": "联网检索与抓取",
  ask: "向用户提问",
  plan: "计划与待办",
  swarm: "子代理与消息",
  skill: "加载技能说明",
  code: "代码执行（PTC）",
  mcp: "MCP 资源",
  other: "其它",
};

function summaryOf(group: string): string {
  if (group.startsWith("mcp:")) return `MCP · ${group.slice("mcp:".length)}`;
  return GROUP_SUMMARY[group] ?? "其它";
}

// 工具的执行体：不带 group 给「分组 + 一句话说明」，带 group 给该组的**用法正文** + d.ts 片段。
//
// 正文与签名一起给，是它取代了「把每组注册成 skill、由目录按需加载」那套：模型在程序里
// `await tools.describe_tool({ group })` 一次就拿到同等的说明与签名，不需要再多一个 skill 目录项。
export function describeTools(
  entries: readonly DescribeEntry[],
  group?: string,
  groupOf?: (group: string) => GroupDescriptor | undefined,
): string {
  const groups = groupEntries(entries);
  if (group === undefined) {
    // 每组都给**一行判据**（「什么时候该看它」），不是只有一个名字：模型据此决定下一句查哪一组。
    return [...groups.keys()]
      .sort()
      .map((name) => {
        const described = groupOf?.(name);
        const title = described?.title ?? summaryOf(name);
        const guideline = described?.guideline ?? "工具说明";
        return `${name} — ${title}：${guideline}`;
      })
      .join("\n");
  }
  const declaration = renderTools(groups.get(group) ?? []);
  // 组正文（中文用法，按组表渲染）；动态组（`mcp:<server>`）没有静态正文，只有签名。
  const section = groupOf?.(group)?.body ?? "";
  return section.length === 0 ? declaration : `${section}\n\n${declaration}`;
}

// `describe_tool` 的工具定义：PTC 程序里 `await tools.describe_tool({ group })` 取某组的 d.ts。
//
// **它是常驻工具**：骨架（`renderSkeleton`）在 system 里承诺了它，模型在程序里一定会调；
// 没注册时上游把调用当未知工具拒掉，模型只能瞎猜参数。所以 PTC 生效时必须在**该 agent 的 scope**
// 上注册它（与工具面的收窄同一个落点）。
//
// 描述留空：PTC 下工具说明不占 system，正文随 describe 结果返回。
export function describeToolDefinition(input: {
  // 这一次要列的工具（调用时现取：工具集可能随按需组变化）。
  readonly entries: () => readonly DescribeEntry[];
  // 某个工具在 harness 里的说明 section 正文（`tool:<name>`）。
  readonly sectionOf: (name: string) => string | undefined;
  // 某个组的描述（标题 / 判据 / 正文）；动态组由实现回落到它那一族。
  readonly groupOf?: (group: string) => GroupDescriptor | undefined;
}): {
  readonly name: "describe_tool";
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly output: {
    readonly schema: Readonly<Record<string, unknown>>;
    readonly render: (
      args: unknown,
      value: { readonly text: string },
    ) => readonly { readonly type: "text"; readonly text: string }[];
  };
  readonly execute: (args: { readonly group?: unknown }) => Promise<{ readonly text: string }>;
} {
  return {
    name: "describe_tool",
    description: "",
    parameters: { group: { type: "string" } },
    output: {
      // 形状照源包：`required` 是对象级字段，不能写在属性里（上游会拒绝这种 schema）。
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args) {
      const group = typeof args.group === "string" ? args.group : undefined;
      const entries = input.entries().map((entry) => ({
        ...entry,
        section: input.sectionOf(entry.name),
      }));
      return { text: describeTools(entries, group, input.groupOf) };
    },
  };
}
