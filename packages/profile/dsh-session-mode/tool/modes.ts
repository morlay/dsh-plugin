/**
 * 模式定义的真源：`cordis.patch.yml` 里 `session-mode` 行的 `config` 由这里渲染。
 *
 * "自定义"就落在这份数据上——装配层（profile 的用户 patch 层）可以整体改写 `config.modes`，也可以只给
 * 某个模式换提示词或工具白名单，不需要任何插件行。
 *
 * `allowTools` 从 [`@morlay/dsh-agent-toolkit/rows`](../../../dsh-agent-toolkit/src/rows.ts) 的
 * `TOOLKIT_TOOL_NAMES` 派生（工具集与汉化同源）：toolkit 的 bundle 在 profile 平面把工具行装一次，模式
 * 只声明"我这些会话能用哪些"。想改某一个模式的名单，直接在这条源数据里加/减。
 */

import { TOOLKIT_TOOL_NAMES } from "@morlay/dsh-agent-toolkit/rows";

/** 一个模式的源定义：就是 `session-mode` 行 `config.modes` 里的一项。 */
export interface ModeSource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 归谁用：`main`（用户选择器，缺省）、`subagent`（可作子代理 mode 的候选）。 */
  readonly role?: readonly ("main" | "subagent")[];
  readonly persona?: { readonly prefix?: string; readonly suffix?: string };
  readonly allowTools: readonly string[];
  readonly instructions?: boolean;
  readonly runtimeContext?: boolean;
}

/** 一个模式的默认模型源定义：就是 `session-mode` 行 `config.models[<模式 id>]`。 */
export interface ModeModelSource {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** 编码模式：编程专家 + 语言与思考纪律 + 工作目录提醒。 */
const CODING_PERSONA = {
  prefix: [
    "你是一个经验丰富的编程专家，YAGNI 是你的编程哲学，PDCA 是你的行为规范。",
    "全程用中文（专有名词除外），包括但不限于思考，回答，工具描述，subagent 提示词；思考不要陷入重复循环，一旦循环立即退出；思考聚焦需求理解与方案设计，不预演具体代码实现，正确性由验证环节确认。",
  ].join("\n"),
  suffix: "你的工作目录在 `{{cwd}}`",
};

/** 对话模式：一个助手，保留语言与思考纪律，没有 suffix。 */
const CHAT_PERSONA = {
  prefix:
    "你是一个助手。全程用中文（专有名词除外），包括但不限于思考，回答，工具描述；思考不要陷入重复循环，一旦循环立即退出。",
};

/** 新会话用哪个模式（`session-mode` 行的 `config.default`）。 */
export const DEFAULT_MODE = "coding";

/**
 * 各模式的默认模型（`session-mode` 行 `config.models`：模式 id → 模型）。
 *
 * 当前为空——两个模式都跟着全局 `agent-default-model`。要改某个模式的默认模型就写在这里（键必须是
 * `MODE_SOURCES` 里的 id，装配期校验会拒绝孤儿键）；用户在设置页写的那份由 settings 的用户层叠在它上面。
 */
export const MODE_MODELS: Readonly<Record<string, ModeModelSource>> = {};

/** 两个模式：编码与对话。 */
export const MODE_SOURCES: readonly ModeSource[] = [
  {
    id: "coding",
    name: "编码模式",
    description: "功能完整的编码 Agent：文件、Shell、检索、联网等工具常驻，其余用法说明按需加载。",
    persona: CODING_PERSONA,
    // 用户可选，也允许作为子代理的 mode（子代理默认继承父 mode，不看角色；这里是"可被指定"的候选集）。
    role: ["main", "subagent"],
    allowTools: [...TOOLKIT_TOOL_NAMES],
  },
  {
    id: "chat",
    name: "对话模式",
    description:
      "只做对话：提问与联网（搜索、抓取）三件工具，不注入系统提示词、工作区指令与技能目录。",
    persona: CHAT_PERSONA,
    // 只做用户侧对话：不做子代理的候选（父在 chat 里派发的子代理仍继承 chat，见 README 的"角色"一节）。
    role: ["main"],
    // 提问与联网三件：工具行由 toolkit 的 bundle 装，这里只收口。
    allowTools: ["ask_user_question", "web_search", "web_fetch"],
    // 没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音。
    instructions: false,
    runtimeContext: false,
  },
];
