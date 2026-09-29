// 模式定义的真源：`session-mode` 行的 `config` 由 `./rows.ts` 渲染（装配入口在 `packages/bundles/session-mode-profile`）。
// `allowTools` 从 `@morlay/dsh-agent-toolkit/rows` 的 `TOOLKIT_TOOL_NAMES` 派生（工具名与汉化同源）；
// 白名单里 preset 没有的工具自动跳过。改某个模式的名单就改这条源数据。

import { TOOLKIT_TOOL_NAMES } from "@morlay/dsh-agent-toolkit/rows";

// 本部署自己注册的那份 agent preset 的 id：两个模式共享它（行清单见 `packages/bundles/session-mode-profile`，
// 它引用 `TOOLKIT_PRESET_ROWS`）。取舍见
// `packages/bundles/session-mode-profile/.agents/adrs/20260929-自己注册preset.md`。
export const MODE_PRESET_ID = "mode-switch";

// 一个模式的源定义：就是 `session-mode` 行 `config.modes` 里的一项。
export interface ModeSource {
  readonly id: string;
  // 挂哪个 agent preset（它的 `id`）：行清单由那个 preset 提供，这里只写扩展。官方四个 shipped preset 照旧可选，
  // 但我们的模式都挂 `MODE_PRESET_ID`；共享是有意的（差异靠会话级收口表达，见 `SessionModes.modeForPreset`）。
  readonly preset: string;
  readonly name: string;
  readonly description: string;
  // 归谁用：`main`（用户选择器，缺省）、`subagent`（可作子代理 mode 的候选）。
  readonly role?: readonly ("main" | "subagent")[];
  readonly persona?: { readonly prefix?: string; readonly suffix?: string };
  readonly allowTools: readonly string[];
  readonly instructions?: boolean;
  readonly runtimeContext?: boolean;
  // 这个模式的默认模型（省略就跟全局 `agent-default-model`）。
  readonly defaultModel?: ModeModelSource;
}

// 一个模式的默认模型源定义：`modes.<模式 id>.defaultModel`。
export interface ModeModelSource {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

// 编码模式：编程专家 + 语言与思考纪律 + 工作目录提醒。
const CODING_PERSONA = {
  prefix: [
    "你是一个经验丰富的编程专家，YAGNI 是你的编程哲学，PDCA 是你的行为规范。",
    "全程用中文（专有名词除外），包括但不限于思考，回答，工具描述，subagent 提示词；思考不要陷入重复循环，一旦循环立即退出；思考聚焦需求理解与方案设计，不预演具体代码实现，正确性由验证环节确认。",
  ].join("\n"),
  suffix: "你的工作目录在 `{{cwd}}`",
};

// 对话模式：一个助手，保留语言与思考纪律，没有 suffix。
const CHAT_PERSONA = {
  prefix:
    "你是一个助手。全程用中文（专有名词除外），包括但不限于思考，回答，工具描述；思考不要陷入重复循环，一旦循环立即退出。",
};

// 新会话用哪个模式（`session-mode` 行的 `config.default`）。
export const DEFAULT_MODE = "coding";

// 两个模式：编码与对话。**同一个 preset，差异全在会话级收口**。
export const MODE_SOURCES: readonly ModeSource[] = [
  {
    id: "coding",
    // 完整工具集由我们自己的 preset（`TOOLKIT_PRESET_ROWS`）提供。
    preset: MODE_PRESET_ID,
    name: "编码模式",
    description: "功能完整的编码 Agent：文件、Shell、检索、联网等工具常驻，其余用法说明按需加载。",
    persona: CODING_PERSONA,
    // 用户可选，也允许作为子代理的 mode（子代理默认继承父 mode，不看角色；这里是"可被指定"的候选集）。
    role: ["main", "subagent"],
    allowTools: [...TOOLKIT_TOOL_NAMES],
  },
  {
    id: "chat",
    // 同一个 preset：行清单里有联网工具，收口才收得成"提问 + 联网"。
    preset: MODE_PRESET_ID,
    name: "对话模式",
    description:
      "只做对话：提问与联网（搜索、抓取）三件工具，不注入系统提示词、工作区指令与技能目录。",
    persona: CHAT_PERSONA,
    // 只做用户侧对话：不做子代理的候选（父在 chat 里派发的子代理仍继承 chat，见 README 的"角色"一节）。
    role: ["main"],
    // 提问与联网三件：行由 preset 提供，这里只收口（preset 没有的自动跳过）。
    allowTools: ["ask_user_question", "web_search", "web_fetch"],
    // 没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音。
    instructions: false,
    runtimeContext: false,
  },
];
