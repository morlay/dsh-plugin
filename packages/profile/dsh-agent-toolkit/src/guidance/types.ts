import type { InjectionMode } from "@morlay/dsh-context-assembler/assembler";

/**
 * 汉化精简的数据形态：**族**（一组工具的一行中文）与**组**（用法正文的分批）都是 pack，
 * 一份文件一个 pack、都由 [`packs/index.ts`](./packs/index.ts) 汇总——"加一个工具/一个组"= 加文件 + 登一行。
 *
 * 族回答"这个工具怎么讲"，组回答"这些用法怎么分批送达"：族按领域切（文件 / shell / 联网 / 团队…），
 * 组按用法切（`base` / `flow` / `delegation` / `team`），一个组会横跨几个族。
 */

/** 一个工具的汉化：模型看到的一行中文（覆盖上游 description）。 */
export interface ToolGuidance {
  /** 工具名（模型侧看到的名字）。 */
  readonly tool: string;
  /** 一行中文：这个工具做什么。参数细节留在 schema、用法留在组正文。 */
  readonly short: string;
}

/** 一个工具族的数据。 */
export interface ToolPack {
  /** 族名（文件同名）：加族时自解释，也是重名检查的报错信息。 */
  readonly family: string;
  readonly tools: readonly ToolGuidance[];
}

export const GROUP_KEYS = ["base", "flow", "delegation", "team"] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

export const BASE_GROUP_KEY: GroupKey = "base";

/** 组 skill 的名字：也是注入条目的 id（`tool-group-<key>`），模型按需加载与用户引用都用它。 */
export function skillNameOf(key: GroupKey): string {
  return `tool-group-${key}`;
}

export interface GroupLine {
  /** 这一行依赖的工具名（数组 = 任一存在即可）；不写表示与工具无关。 */
  readonly when?: string | readonly string[];
  readonly text: string;
}

export interface ToolGroup {
  readonly key: GroupKey;
  readonly title: string;
  /** 组 skill 的目录行摘要：讲清什么时候该加载它。 */
  readonly skillDescription: string;
  /**
   * 组 skill 正文：一行一条，**直接讲怎么用**（上游说明的要点已经吸收进来，所以不拼接上游原文）。
   *
   * **行首的工具名就是这一行的标注**（`read：读文本文件…`）——正文按该会话实际可见的工具修剪：
   * 模式只给了一部分工具时，讲别的工具的行就该消失（"都是 base 组，但只有其中几个工具"）。
   * 行首不是工具名的行（例如总则那句）与具体工具无关，常在。
   */
  readonly lines: readonly GroupLine[];
  /** 正文到达模型的方式：`base` 自动注入，其余按需加载。 */
  readonly injection: InjectionMode;
  /** 被丢弃的上游说明 / 规则 section：要点已在正文里，原文不再进提示词。 */
  readonly drops: readonly string[];
  /** 组内所有可能的工具名（并集）；渲染时按实际装配过滤。 */
  readonly tools: readonly string[];
  /**
   * **入口工具**（任一存在即可）：这一组凭什么成立。缺省就是 {@link ToolGroup.tools} 的全集。
   *
   * 只在"组内混了两套来源"时才需要写：`team` 组的成员里 `send_message` / `list_agents` /
   * `interrupt_agent` 子代理控制行也提供，用全集当判据会让没有 Agent Teams 的会话也列出它，
   * 所以它的入口只认团队插件独有的那几个。
   */
  readonly requires?: readonly string[];
}

/** 一个用法组的数据。 */
export interface GroupPack {
  /** pack 名（文件同名）：重 key 检查的报错信息里用它。 */
  readonly family: string;
  readonly group: ToolGroup;
}
