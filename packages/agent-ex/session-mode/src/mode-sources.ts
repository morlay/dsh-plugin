// 模式定义的真源：内置三个模式（`{dshHome}/modes/*.toml` 覆盖同 id 的那份）。
// 行清单不由本包持有：会话挂着的 agent preset 提供工具，`allowTools` 只在这之上收窄——留空就是不收窄。
import type { PolicyName } from "./endpoint/session-mode-shapes.ts";

// 一个模式的源定义：`modes.<id>` 里的一项（省略的字段由 `normalizeMode` 补默认）。
export interface ModeSource {
  readonly id: string;
  readonly presetsOnly?: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly role?: readonly ("main" | "subagent")[];
  readonly persona?: { readonly prefix?: string; readonly suffix?: string };
  readonly allowTools?: readonly string[];
  readonly denyTools?: readonly string[];
  readonly allowSkills?: readonly string[];
  readonly denySkills?: readonly string[];
  readonly allowPolicies?: readonly PolicyName[];
  readonly denyPolicies?: readonly PolicyName[];
  readonly instructions?: boolean;
  readonly skills?: boolean;
  readonly dropSections?: readonly string[];
  readonly runtimeContext?: boolean;
  readonly defaultModel?: {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string;
  };
}

// 编码模式：编程专家 + 语言与思考纪律。
// 工作目录那半句不写：上游 0.2.1-alpha.2 起工作目录由 `working-directory:current` 注入，persona 的插值是严格的，
// 残留 `{{cwd}}` 会在渲染时直接抛 `unknown prompt variable`。
const CODING_PERSONA = {
  prefix: [
    "你是一个经验丰富的编程专家，YAGNI 是你的编程哲学，PDCA 是你的行为规范。",
    "全程 MUST 用中文（专有名词除外），包括但不限于思考，回答，工具描述，subagent 提示词；思考 NEVER 陷入重复循环，一旦循环立即退出；思考 SHOULD 聚焦需求理解与方案设计，不预演具体代码实现，正确性由验证环节确认。",
    "单轮次内 MUST 完成明确的任务，任务未完成 NEVER 停下，除非有明确分歧点需要停下询问用户来做决断",
  ].join("\n"),
};

// 对话模式：一个助手，保留语言与思考纪律，没有 suffix。
const CHAT_PERSONA = {
  prefix:
    "你是一个助手。全程用中文（专有名词除外），包括但不限于思考，回答，工具描述；思考不要陷入重复循环，一旦循环立即退出。",
};

// 原样模式：一份什么都不加的扩展（persona 空、名单全空、开关走默认），用来对照"没有模式"的装配结果。
export const NOOP_MODE_ID = "noop";

// 新会话用哪个模式。
export const DEFAULT_MODE = "coding";

// 三个内置模式：都不限制 preset，差异全在会话级收口。
export const MODE_SOURCES: readonly ModeSource[] = [
  {
    id: "coding",
    name: "编码模式",
    description: "功能完整的编码 Agent：文件、Shell、检索、联网等工具常驻，其余用法说明按需加载。",
    persona: CODING_PERSONA,
    role: ["main", "subagent"],
    // 不写 `allowTools`：用会话挂着的 preset 提供的全部工具。
    denyTools: ["load_workspace_dependencies", "plugin_manager"],
    // 官方 Office 技能按名排除：目录里不列、`skill` 工具加载也被拒。
    denySkills: ["office-docx", "office-pptx", "office-xlsx"],
    denyPolicies: ["fs/edit-intent", "fs/write-intent"],
  },
  {
    id: "chat",
    name: "对话模式",
    description: "只做对话：提问与联网（搜索、抓取）三件工具，不注入工作区指令与技能目录。",
    persona: CHAT_PERSONA,
    role: ["main"],
    allowTools: ["ask_user_question", "web_search", "web_fetch"],
    instructions: false,
    runtimeContext: false,
  },
  {
    id: NOOP_MODE_ID,
    name: "原样模式",
    description: "与上游一致：不加人格提示词、不收窄工具与技能、policy 规则全开、官方注入面照旧。",
    role: ["main", "subagent"],
  },
];
