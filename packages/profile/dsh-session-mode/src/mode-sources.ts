// 模式定义的真源：`session-mode` 行的 `config` 由 `./rows.ts` 渲染（装配入口在 `packages/bundles/session-mode-profile`）。
// **行清单不由本包持有**：谁挂在这份定义上的会话用什么工具，取决于它挂着的 agent preset（官方 shipped preset），
// `allowTools` 只是在这之上收窄——留空就是不收窄。改某个模式的名单就改这条源数据。

import type { PolicyName } from "./shared.ts";

// 一个模式的源定义：就是 `session-mode` 行 `config.modes` 里的一项。
export interface ModeSource {
  readonly id: string;
  // 这个模式**只允许**挂哪些 agent preset（它们的 `id`）：**可选**，不写（留空）就是不限制——选这个模式不换 preset，
  // 会话保持它当前挂着的那份，行清单由那份 preset 提供（官方四个 shipped preset 照旧可选）。有值时切模式会让 preset
  // 落进名单：当前的已经在里面就不动，否则换成第一个。模式定义里可以整体改写它（用户 patch 层）。
  readonly presetsOnly?: readonly string[];
  readonly name: string;
  readonly description: string;
  // 归谁用：`main`（用户选择器，缺省）、`subagent`（可作子代理 mode 的候选）。
  readonly role?: readonly ("main" | "subagent")[];
  readonly persona?: { readonly prefix?: string; readonly suffix?: string };
  // 这个模式能用的工具；**可选**，不写（留空）就是不设收窄——用会话挂着的 preset 的全部工具。
  readonly allowTools?: readonly string[];
  // 这个模式不用的工具（黑名单）：从 `allowTools` 定的那份里减掉（deny 优先）。
  readonly denyTools?: readonly string[];
  // 这个模式能用的技能；**可选**，不写（留空）就是不设收窄——技能注册表里有什么就用什么。
  readonly allowSkills?: readonly string[];
  // 这个模式不用的技能（黑名单）：从 `allowSkills` 定的那份里减掉（deny 优先）。
  readonly denySkills?: readonly string[];
  // 上游 policy 规则的生效白名单：**可选**，不写（留空）= 全部规则生效。
  readonly allowPolicies?: readonly PolicyName[];
  // 上游 policy 规则的黑名单：列出的规则禁用（它在上游那条 waterfall 上的裁决被绕过）。
  readonly denyPolicies?: readonly PolicyName[];
  readonly instructions?: boolean;
  // 是否要技能目录（官方 `skill-catalog` 的注入）：**可选**，不写就按这个模式自己的工具名单推导（名单里含 `skill`
  // 就要，见 `modes.ts` 的 `derivedSkills`）。`coding` 留空名单 = 要；`chat` 的三件里没有 `skill` = 不要。
  readonly skills?: boolean;
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

// 编码模式：编程专家 + 语言与思考纪律。
// 这里**不再有**工作目录那半句（原为 `你的工作目录在 \`{{cwd}}\``）：上游 0.2.1-alpha.2 起工作目录由
// `working-directory:current` 这条运行时上下文注入（文本是 `Current working directory: "<绝对路径>".`），
// 而 persona 用的提示词插值是**严格**的——`cwd` 变量已不再注册，残留 `{{cwd}}` 会在渲染时直接抛
// `unknown prompt variable`（注册变量只剩 provider / model）。
const CODING_PERSONA = {
  prefix: [
    "你是一个经验丰富的编程专家，YAGNI 是你的编程哲学，PDCA 是你的行为规范。",
    "全程用中文（专有名词除外），包括但不限于思考，回答，工具描述，subagent 提示词；思考不要陷入重复循环，一旦循环立即退出；思考聚焦需求理解与方案设计，不预演具体代码实现，正确性由验证环节确认。",
  ].join("\n"),
};

// 对话模式：一个助手，保留语言与思考纪律，没有 suffix。
const CHAT_PERSONA = {
  prefix:
    "你是一个助手。全程用中文（专有名词除外），包括但不限于思考，回答，工具描述；思考不要陷入重复循环，一旦循环立即退出。",
};

// 原样模式：**一份什么都不加的扩展**——persona 空、名单全空、三个开关不写，装配结果与"没有模式"时一致。
// 它存在的理由有两个：想完全按上游默认跑的会话有个可选项；排查扩展干扰时有一个对照档（切到它就只剩上游行为）。
// 它同样是 `session-mode` 行的一份定义，所以模式自己的收口代码照常经过它——只是没有任何收口要求。
const NOOP_MODE_ID = "noop";

// 新会话用哪个模式（`session-mode` 行的 `config.default`）。
export const DEFAULT_MODE = "coding";

// 三个模式：编码、对话与原样。**都不限制 preset**（差异全在会话级收口），行清单由会话挂着的那份提供：`coding`
// 不收窄（用全部），`chat` 收成提问 + 联网三件，`noop` 什么都不加。
export const MODE_SOURCES: readonly ModeSource[] = [
  {
    id: "coding",
    name: "编码模式",
    description: "功能完整的编码 Agent：文件、Shell、检索、联网等工具常驻，其余用法说明按需加载。",
    persona: CODING_PERSONA,
    // 用户可选，也允许作为子代理的 mode（子代理默认继承父 mode，不看角色；这里是"可被指定"的候选集）。
    role: ["main", "subagent"],
    // 不写 `allowTools`：不设收窄——这个会话用它挂着的 preset 提供的全部工具（抄一份清单只会与行清单漂移）。
    // 只排除一件工具：官方 Office 组合（宿主代码挂载，profile 层停不掉它的行）里那个载荷查询。
    denyTools: ["load_workspace_dependencies"],
    // 官方 Office 技能的三个名字同样按会话排除：技能目录里不列它们，`skill` 工具加载它们也被拒。
    // 名单是技能名这一层的模型可见契约（官方 `skill-office` 的 `SKILL_NAMES`），跟着上游改名走。
    denySkills: ["office-docx", "office-pptx", "office-xlsx"],
    //
    // `denyPolicies` 只禁 `fs/edit-intent`（上游那条"先读后改"）：改文件不再要求先读过——写路径上的
    // `fs/write-intent`（陈旧版本 CAS 那层安全网）照旧生效，那正是这条配置不写成"两条都禁"的理由。
    denyPolicies: ["fs/edit-intent"],
  },
  {
    id: "chat",
    // 行清单同样跟着会话：白名单里 preset 没有的工具自动跳过，所以这个模式在缺联网行的 preset 上收不出三件。
    name: "对话模式",
    description:
      "只做对话：提问与联网（搜索、抓取）三件工具，不注入系统提示词、工作区指令与技能目录。",
    persona: CHAT_PERSONA,
    // 只做用户侧对话：不做子代理的候选（父在 chat 里派发的子代理仍继承 chat，见 README 的"角色"一节）。
    role: ["main"],
    // 提问与联网三件：行由会话挂着的 preset 提供，这里只收口（preset 没有的自动跳过）。
    allowTools: ["ask_user_question", "web_search", "web_fetch"],
    // 不写任何 policy 名单：上游两条规则都照旧生效。这个模式没有文件工具，两条都碰不到——
    // 配了只是噪音，所以留空。
    // 没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音。
    //
    // 注入面全关：`instructions: false` 丢掉官方 `agent-instructions`（工作区指令）的注入；这个模式不写
    // `skills`，而白名单三件里没有 `skill`、`denyTools` 也留空 → 推导成 `false`，官方 `skill-catalog` 的注入
    // 同样丢掉；`runtimeContext: false` 连动态快照与时钟（`standard` 那类 preset 声明的 `time-context`）一起收。
    // **收不掉的**：上游 `working-directory:current` 是 required 的目录上下文（0.2.1-alpha.2 起工作目录只走这条），
    // 抑制可选运行时上下文不影响它——chat 会话的模型仍会看到工作目录那条快照。
    // 取舍见 `.agents/designs/20260929-抑制官方注入面.md`。
    instructions: false,
    runtimeContext: false,
  },
  {
    id: NOOP_MODE_ID,
    name: "原样模式",
    description: "与上游一致：不加人格提示词、不收窄工具与技能、policy 规则全开、官方注入面照旧。",
    // 用户可选，也允许作为子代理的 mode：它不做任何过滤，给子代理当候选同样成立。
    role: ["main", "subagent"],
    // 其余字段一律不写：名单留空 = 不设收窄，`instructions` / `runtimeContext` 走 schema 默认 `true`，
    // `skills` 由工具名单推导（`allowTools` 留空 → 含 `skill` → 要目录），`presetsOnly` 留空 = 不限制、`defaultModel` 跟全局。
  },
];
