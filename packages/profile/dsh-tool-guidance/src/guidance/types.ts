// 汉化精简的数据形态：**族**（一组工具的一行中文）与**组**（用法正文的分批）都是 pack，一份文件一个 pack、都由
// `packs/index.ts` 汇总。族按领域切（文件 / shell / 联网 / 团队…），组按用法切，一个组会横跨几个族。

// 一个工具的汉化：模型看到的一行中文（覆盖上游 description）。
export interface ToolGuidance {
  // 工具名（模型侧看到的名字）。
  readonly tool: string;
  // 一行中文：这个工具做什么。参数细节留在 schema、用法留在组正文。
  readonly short: string;
}

// 一个工具族的数据。
export interface ToolPack {
  // 族名（文件同名）：加族时自解释，也是重名检查的报错信息。
  readonly family: string;
  readonly tools: readonly ToolGuidance[];
}

export const GROUP_KEYS = ["base", "flow", "delegation", "team"] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

export const BASE_GROUP_KEY: GroupKey = "base";

// 组 skill 的名字（`tool-group-<key>`）：按需加载的注册名，也是 `base` 常驻注入那一条的幂等键。
export function skillNameOf(key: GroupKey): string {
  return `tool-group-${key}`;
}

export interface GroupLine {
  // 这一行依赖的工具名（数组 = 任一存在即可）；不写表示与工具无关。
  readonly when?: string | readonly string[];
  readonly text: string;
}

export interface ToolGroup {
  readonly key: GroupKey;
  readonly title: string;
  // 组 skill 的目录行摘要：讲清什么时候该加载它（`base` 不进目录，这一条只保持组表形态齐整）。
  readonly skillDescription: string;
  // 正文：一行一条，**直接讲怎么用**（要点吸收自上游说明，所以不拼接上游原文）。行首的工具名就是这一行的
  // 标注：`base` 的正文由本行常驻注入，渲染时按**这个会话装配结果里最终可见的工具目录**过滤（收窄掉的工具
  // 不在目录里，也就不在正文里）；其余组注册进官方 skill 目录，正文在装配期定型。行首不是工具名的行与具体
  // 工具无关，常在。
  readonly lines: readonly GroupLine[];
  // 被丢弃的上游说明 / 规则 section：要点已在正文里，原文不再进提示词。
  readonly drops: readonly string[];
  // 组内所有可能的工具名（并集）。
  readonly tools: readonly string[];
}

// 一个用法组的数据。
export interface GroupPack {
  // pack 名（文件同名）：重 key 检查的报错信息里用它。
  readonly family: string;
  readonly group: ToolGroup;
}
