// 汉化精简的数据形态：**只有一层——工具组**。一个用途域一份 pack：工具 → 一行中文、用法正文、注入时期、
// 被吸收掉的上游 section、以及组内工具名，全在同一个结构里。

// 一个工具的汉化：模型看到的一行中文（覆盖上游 description）。
export interface ToolGuidance {
  readonly tool: string;
  readonly short: string;
}

// 组 skill 的名字（`tool-group-<key>`）：按需加载的注册名，也是 `base` 常驻注入那一条的幂等键。
export function skillNameOf(key: string): string {
  return `tool-group-${key}`;
}

export interface GroupLine {
  // 这一行依赖的工具名（数组 = 任一存在即可）；不写表示与工具无关。
  readonly when?: string | readonly string[];
  readonly text: string;
}

export interface ToolGroup {
  readonly key: string;
  readonly title: string;
  // 组 skill 的目录行摘要：讲清什么时候该加载它（`init` 组不进目录，它的正文常驻注入）。
  readonly guideline: string;
  // 注入时期：`init` = 装配期随 `<system-reminder>` 常驻注入；`on-demand` = 注册成 skill、由目录按需加载。
  readonly injection: "init" | "on-demand";
  // 正文：一行一条，直接讲怎么用。
  readonly lines: readonly GroupLine[];
  // 被丢弃的上游说明 / 规则 section：要点已在正文里，原文不再进提示词。
  readonly drops: readonly string[];
  // 组内的工具（名字 + 一行中文）。
  readonly tools: readonly ToolGuidance[];
}
