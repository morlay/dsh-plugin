// `describe_tool`：PTC 程序里现取某组工具的 d.ts（不把全量签名塞进 system）。
//
// 上游 PTC 执行器只允许"程序内（nested）调用任意已注册工具"，所以这里注册成普通工具即可：
// 程序里 `await describe_tool({ group: "fs" })` 拿到 `declare global { interface ToolsSdk { … } }`
// （成员就是 `tools` 上的属性；名字带引号的用 `tools["名字"](args)`）。

import { jsonSchemaToTs } from "@deepseek-ai/dsh-tool-executor-ptc";
import { SHORT_TOOL_DESCRIPTIONS } from "@morlay/dsh-tool-guidance/groups";
import { isOnDemandToolGroup, toolGroupOf } from "./shared.ts";
import { renderTools, type PtcToolSchema } from "./ptc-sdk.ts";

/** 一条工具的静态描述（描述文本 + 宽松的 args/output 类型）。 */
export interface DescribeEntry {
  readonly name: string;
  readonly description: string;
  /** 工具的参数 JSON Schema。 */
  readonly parametersSchema?: unknown;
  /** 工具的输出 JSON Schema。 */
  readonly outputSchema?: unknown;
}

// 按工具组分组；组名与面板上的分组一致（`mcp:agent-browser` 等）。
export function groupEntries(
  entries: readonly DescribeEntry[],
): Map<string, readonly PtcToolSchema[]> {
  const groups = new Map<string, PtcToolSchema[]>();
  for (const entry of entries) {
    const group = toolGroupOf(entry.name);
    const list = groups.get(group);
    const schema: PtcToolSchema = {
      name: entry.name,
      // 中文短描述统一由 `dsh-tool-guidance` 维护；没有登记就退回工具自己的 description。
      description: SHORT_TOOL_DESCRIPTIONS[entry.name] ?? entry.description,
      // 参数与返回都按工具自己的 schema 转成 TS。
      args: schemaText(entry.parametersSchema),
      output: schemaText(entry.outputSchema),
    };
    if (list === undefined) groups.set(group, [schema]);
    else list.push(schema);
  }
  return groups;
}

// 输出 schema → TS；转不了就是 `unknown`（`jsonSchemaToTs` 自己兜底）。
function schemaText(schema: unknown): string {
  return schema === undefined ? "JsonValue" : jsonSchemaToTs(schema);
}

// 分组的简要说明（一句话，不展开成员）。
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
  onDemand: "按需工具",
  other: "其它",
};

// 常用组的说明（中文）：随 describe 一起返回，不占 system。
const GROUP_SECTION: Readonly<Record<string, string>> = {
  collab:
    "## 协作\n\n可以派发子代理、给队友发消息、等待队友；所有人共享同一个工作目录与文件系统，写操作要划分互不重叠的范围，必要时用共享任务记录范围与依赖。",
  "mcp:resources":
    "## MCP 资源\n\n按 URI 读取 MCP server 暴露的只读资源（文档、日志、数据）；先 list 再 read。当前 server 都是 tools-only，通常没有可读资源。",
  fs: "## 文件\n\n读、写、改文件与检索；改文件前先读当前内容，避免覆盖别人的改动。",
  shell: "## Shell\n\n执行命令；不要用它绕过文件工具做批量改写。",
  "web-access": "## 联网\n\n搜索与抓取网页。",
  skill: "## 技能\n\n按需加载技能说明，再照着做。",
};

function sectionOfGroup(group: string): string {
  return GROUP_SECTION[group] ?? "";
}

function summaryOf(group: string): string {
  if (group.startsWith("mcp:")) return `MCP · ${group.slice("mcp:".length)}`;
  return GROUP_SUMMARY[group] ?? "其它";
}

// 工具的执行体：不带 group 给「按需组清单 + 一句话说明」，带 group 给该组的 d.ts 片段。
//
// 清单只列**按需组**：常驻组的签名已经随系统提示注入，再列一次只是让模型重复取同一份签名。
// 三种取不到的分支都给一句点名的话，不返回空串——空串对模型等于静默失败，它会以为是自己拼错了组名。
export function describeTools(entries: readonly DescribeEntry[], group?: string): string {
  const groups = groupEntries(entries);
  const onDemand = [...groups.keys()].filter(isOnDemandToolGroup).sort();
  if (group === undefined) {
    if (onDemand.length === 0) {
      return "当前会话没有按需组：能用工具的签名都已随系统提示注入，直接按那些签名调用即可。";
    }
    return onDemand.map((name) => `${name} — ${summaryOf(name)}`).join("\n");
  }
  if (isOnDemandToolGroup(group)) {
    if (!groups.has(group)) {
      return `${group} 这个按需组当前没有可用工具（可能被模式名单收窄掉了）。可取组：${onDemand.join(" | ") || "（无）"}`;
    }
    const declaration = renderTools(groups.get(group) ?? []);
    const section = sectionOfGroup(group);
    return section.length === 0 ? declaration : `${section}\n\n${declaration}`;
  }
  if (groups.has(group)) {
    return `${group} 是常驻组，签名已经随系统提示注入，不需要 describe；直接按系统提示里的 d.ts 调用即可。`;
  }
  return `没有 ${group} 这个组。可取组：${onDemand.join(" | ") || "（当前会话没有按需组）"}`;
}
