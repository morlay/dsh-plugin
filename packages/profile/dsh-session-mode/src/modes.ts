// 模式的定义形状与它的装配期校验：一个模式就是"一段提示词 + 一组能力开关"，本行的 `config.modes` 声明它们。
// 行清单来自会话挂着的那份 agent preset（`presetsOnly` 只声明这个模式允许挂哪些）；装配层能整体改写 `modes`，
// 也可以只给某几个模式换提示词或白名单。
// 取舍见 `.agents/adrs/20260925-默认模型住在模式定义里.md`、`.agents/designs/20260924-会话模式.md`。

import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { POLICY_NAMES } from "./shared.ts";

// 一个模式的提示词：两段文本，注册成 agent 作用域的 `deployment:persona-prefix` / `-suffix` section。
export interface SessionModePersona {
  // 系统提示词最前的一段；空串表示不遮蔽部署级那层。
  readonly prefix: string;
  // 系统提示词最后的一段；空串表示不写。
  readonly suffix: string;
}

// 一个模式对谁可见：`main` 进用户选择器（会话级选择），`subagent` 表示它**可以**作为子代理的 mode。
// 两个角色可以同时声明；不写默认 `["main"]`。`subagent` 现在只是候选集的声明——子代理默认继承父 mode。
export type SessionModeRole = "main" | "subagent";

// 一个模式的默认模型；省略的字段跟着 provider 默认走（与全局 `agent-default-model` 同形状）。
export interface SessionModeModel {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

// 退役的顶层形状：模式 id → 模型（默认模型现在住在各自的模式里）。
export type SessionModeModels = Readonly<Record<string, SessionModeModel>>;

// 一个模式：提示词 + 能力开关。这份形状是 **schema 归一化之后**的（每个字段都有值，schema 用默认补上），
// 配置里能省略哪些字段看 `modeSchema` 的 default。
export interface SessionMode {
  // 这个模式**只允许**挂哪些 **agent preset**（官方四个，或本部署自己注册的那一份）。**留空（不写）表示不限制**：
  // 选这个模式不换 preset，会话保持它当前挂着的那份；行清单由那份 preset 提供，模式自己的那几项扩展
  // （persona / 工具名单 / policy 名单 / 三个开关 / `defaultModel`）在任意 preset 上都照常生效。
  // 有值时切到这个模式会让会话的 preset 落进名单：当前那份已经在名单里就原样不动，否则换成名单里的**第一个**
  // （`modes.ts` 只声明"允许哪些"，落在哪个由 `SessionModes.select` 决定）。多个模式可以共享同一份名单。
  readonly presetsOnly: string[];
  // 模式的展示名（选择面归官方 roster；这里留着做事实文案）。
  readonly name: string;
  // 一句话说明这个模式干什么；空串表示没写。
  readonly description: string;
  // 这个模式归谁用：`main`（用户选择器）/ `subagent`（可作子代理 mode）。至少一个。
  readonly role: SessionModeRole[];
  // 该模式的提示词。
  readonly persona: SessionModePersona;
  // 这个模式能用哪些工具；其余工具既不进模型目录、调用也被执行层拒绝，它们自己的说明 section
  // （`tool:<工具名>`）也不留在提示词里。**留空表示不设收窄**：这个会话用它挂着的 preset 装着的全部工具
  // （想收窄就列名单——"全都要"不需要抄一份清单）。
  readonly allowTools: string[];
  // 这个模式**不用**哪些工具（黑名单）：从 `allowTools` 定下的那份里减掉（`allowTools` 留空时就是从全部里减）。
  // 留空表示不禁任何工具。同时命中两份名单时以这里为准（deny 优先）。
  readonly denyTools: string[];
  // 这个模式能用哪些**技能**；其余的既不进技能目录，`skill` 工具加载它也被拒。**留空表示不设收窄**：技能注册表
  // 里有什么就用什么（官方 `skill-office` 那类由宿主代码挂载的技能也在这份"全部"里）。
  readonly allowSkills: string[];
  // 这个模式**不用**哪些技能（黑名单）：从 `allowSkills` 定下的那份里减掉（`allowSkills` 留空时就是从全部里减）。
  // 留空表示不禁任何技能；同时命中两份名单时以这里为准（deny 优先）。
  readonly denySkills: string[];
  // 上游 policy 规则的**生效白名单**：留空（或不写）表示全部规则照旧生效；有值表示只有列出的那些生效，
  // 其余的按 `denyPolicies` 那一套被绕过。名单见 `POLICY_NAMES`。空数组与不写同义。
  readonly allowPolicies: string[];
  // 上游 policy 规则的黑名单：列出的规则**禁用**——上游在那条 waterfall 上的裁决（连它抛出的拒绝）被丢掉，
  // 调用按"没有这条规则"继续。留空表示一条都不禁；同时命中两份名单时以这里为准（deny 优先）。
  readonly denyPolicies: string[];
  // 是否要 instruction 类注入。缺省要；`false` 表示这个模式一条都不要——对话模式就是它。落到两处：丢掉官方
  // `agent-instructions` 的注入（`agent/pre-step` 上过滤），以及关掉通道自己的降级注入。
  readonly instructions: boolean;
  // 是否要技能目录。**可选**：不写就由这个模式自己的工具名单推导——`(allowTools 留空 ? 全部 : allowTools) −
  // denyTools` 里含 `skill` 就要（`allowTools` 留空即"全部"，所以只有 `denyTools` 能把它推成 `false`）。
  // `false` 表示这个模式不要技能目录：丢掉官方 `skill-catalog` 的注入（`skill` 工具的收窄仍归 `allowTools`）。
  readonly skills?: boolean;
  // 是否要 runtime context（文件沙箱策略、审批策略那两条动态快照）。缺省要；`false` 表示这个模式不要它们
  // ——对话模式没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音。
  readonly runtimeContext: boolean;
  // 这个模式的默认模型；省略就跟全局 `agent-default-model`。**可选**：没配的模式在页面上不出现在这一行
  // （`defaultModel` 是它所在模式的一个可加字段）。
  readonly defaultModel?: SessionModeModel;
  // 退役字段：单个 `preset` 已换成白名单 `presetsOnly`。这里留着只为**报错**（见 `configProblem`），页面上不出现。
  readonly preset?: string;
}

// `skills` 不写时的推导：起点是白名单（留空 = 起点是全部工具，含 `skill`），减去黑名单，还留着 `skill` 就要技能
// 目录。名单留空等于"全部工具"，所以只有 `denyTools` 能把它推成 `false`。
export function derivedSkills(mode: Pick<SessionMode, "allowTools" | "denyTools">): boolean {
  const allowed = mode.allowTools.length === 0 || mode.allowTools.includes("skill");
  return allowed && !mode.denyTools.includes("skill");
}

// 每个字段都带 default：schema 的产物因此没有 `undefined` 键（`exactOptionalPropertyTypes` 下"缺省的键"
// 会与可选属性对不上）。`description()` 的类型签名只声明 `string`，这里做一次类型放行。
const localized = (text: { zh: string; en: string }): string => text as unknown as string;

const personaSchema = z.object({
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});

// 角色是个封闭集合：写错的 role 在装配期就拒绝，而不是静默变成"谁都不用"。
const roleSchema = z.union([z.const("main"), z.const("subagent")]);

// 默认模型的形状与全局 `agent-default-model` 一致；省略 effort 就跟 provider 默认。
const modelSchema = z.object({
  provider: z
    .string()
    // 候选来自客户端注册的具名源 `llm-providers`：字段只说"这是选一个"，不关心行 id 与路径。
    .role("select", { source: "llm-providers" })
    .description(
      localized({
        zh: "服务商 id（部署里注册的任意路由，不论哪个适配器插件注册的）。",
        en: "Provider id (any route registered in this deployment, whichever adapter plugin supplies it).",
      }),
    ),
  model: z
    .string()
    // 具名源 `llm-models` 自己声明依赖 `provider`（换服务商就换清单）。
    .role("select", { source: "llm-models" })
    .description(
      localized({
        zh: "模型 id。",
        en: "Model id.",
      }),
    ),
  reasoningEffort: z.string().description(
    localized({
      zh: "思考档位；省略就跟服务商自己的默认。",
      en: "Reasoning effort; unset keeps the provider's own default.",
    }),
  ),
});

// 本包 config 的**源码形状**：装配层与设置页写的那个形状。
export interface Config {
  // 新会话（还没选过模式的会话）用哪个模式。必须是 `modes` 里的一个 id。
  readonly default: string;
  // 模式清单：id → 定义（含各自的 `defaultModel`）。顺序即选择器里的顺序（`Object.entries` 的插入序）。
  readonly modes: Record<string, SessionMode>;
  // 退役字段：各模式的默认模型住在每个模式自己的 `defaultModel` 里；这里留着只为装配期报错
  // （见 `configProblem`）。
  readonly models?: SessionModeModels;
}

// schema 解析之后的形状：volatile 字段被换成**稳定引用**，读它要过 `.get()`（设置页改的就是同一份）。
//
// `default` 与 `modes` 都是 volatile：默认模式与整份模式清单（含各自的 `defaultModel`）都在行配置页上。
export interface ResolvedConfig {
  readonly default: Volatile<string>;
  readonly modes: Volatile<Record<string, SessionMode>>;
  // 退役的顶层字段：解析后仍在这儿（普通值，不 volatile），装配期据此发现"还配着值"并报错。
  readonly models: SessionModeModels;
}

const modeSchema: z<SessionMode> = z.object({
  // 退役字段：这里留着只为**报错**（见 `configProblem`），页面上不出现（`hidden()`）。不给默认：没配就没这个键。
  preset: z.string().hidden(),
  presetsOnly: z
    .array(z.string())
    // 候选是部署里注册的 agent preset（具名源 `agent-presets`）：字段只说"这是选几个"，不关心它从哪来。
    .role("select", { source: "agent-presets" })
    .default([])
    .description(
      localized({
        zh: "这个模式只允许挂哪些 agent preset（它们的 id，官方或本部署自建的）：行清单由挂着的那份提供，几个模式可以共享同一份名单。留空表示**允许全部**——哪份 preset 都行，选这个模式也不动会话当前挂着的那份；有值时当前的已经在名单里就不动，否则换成名单里的第一个。模式自己的提示词、工具收口与开关照常生效。",
        en: "Which agent presets this mode may ride on (their ids, shipped or deployment-owned): that preset supplies the row list, and several modes may share one list. Empty means **every preset is allowed** — selecting the mode then leaves the session's current preset alone; when set, the current one stays if it is listed, otherwise the session switches to the first entry. The mode's persona, tool narrowing, and switches apply either way.",
      }),
    ),
  name: z
    .string()
    .required()
    .description(
      localized({
        zh: "模式名（事实文案；选择面归官方 roster）。",
        en: "Mode name (fact copy; the picker belongs to the official roster).",
      }),
    ),
  description: z
    .string()
    .default("")
    .description(
      localized({
        zh: "一句话说明。",
        en: "One-line description.",
      }),
    ),
  role: z
    .array(roleSchema)
    .default(["main"])
    .description(
      localized({
        zh: "谁可以用这个模式：`main`（会话选择器里可选）或 `subagent`（子代理继承）。",
        en: "Who may use this mode: `main` (selectable in sessions) or `subagent` (inherited by subagents).",
      }),
    ),
  persona: personaSchema.default({}),
  allowTools: z
    .array(z.string())
    .default([])
    .description(
      localized({
        zh: "这个会话能用的工具；其余既不进目录，调用也被拒。**留空就是不设收窄**：用这个会话挂着的 preset 提供的全部工具。",
        en: "Tools this session may use; everything else leaves the catalog and calls are refused. Leave it empty to narrow nothing: the session then uses every tool its preset provides.",
      }),
    ),
  denyTools: z
    .array(z.string())
    .default([])
    .description(
      localized({
        zh: "这个模式不用的工具（黑名单）：从 `allowTools` 定下的那份里减掉（`allowTools` 留空就是从全部里减）。留空 = 一条都不禁；同时命中两份名单时以这里为准。",
        en: "Tools this mode must not use (deny list): subtracted from whatever `allowTools` settled on (with an empty `allowTools`, from everything). Empty denies nothing; a name in both lists is denied.",
      }),
    ),
  allowSkills: z
    .array(z.string())
    .default([])
    .description(
      localized({
        zh: "这个模式能用的技能；其余既不进技能目录，`skill` 工具加载它也被拒。**留空就是不设收窄**：技能注册表里有什么就用什么。",
        en: "Skills this mode may use; everything else leaves the skill catalog and loading it through the `skill` tool is refused. Leave it empty to narrow nothing: the session then sees every skill the registry carries.",
      }),
    ),
  denySkills: z
    .array(z.string())
    .default([])
    .description(
      localized({
        zh: "这个模式不用的技能（黑名单）：从 `allowSkills` 定下的那份里减掉（`allowSkills` 留空就是从全部里减）。留空 = 一条都不禁；同时命中两份名单时以这里为准。",
        en: "Skills this mode must not use (deny list): subtracted from whatever `allowSkills` settled on (with an empty `allowSkills`, from everything). Empty denies nothing; a name in both lists is denied.",
      }),
    ),
  allowPolicies: z
    .array(z.string())
    .default([])
    .description(
      localized({
        zh: "上游 policy 规则的生效白名单（`fs/write-intent` / `fs/edit-intent`）：留空 = 全部规则照旧生效；有值 = 只有列出的生效，其余的被绕过。",
        en: "Allow list of upstream policy rules that stay in force (`fs/write-intent` / `fs/edit-intent`): empty keeps every rule; when set, only the listed ones stay, and the others are bypassed.",
      }),
    ),
  denyPolicies: z
    .array(z.string())
    .default([])
    .description(
      localized({
        zh: "上游 policy 规则的黑名单：列出的规则禁用（它的裁决连拒绝一起丢掉，调用按没有这条规则继续）。留空 = 一条都不禁；同时命中两份名单时以这里为准。",
        en: "Deny list of upstream policy rules: the listed ones are disabled — their verdict (rejection included) is dropped and the call proceeds as if the rule were absent. Empty denies nothing; a name in both lists is denied.",
      }),
    ),
  instructions: z
    .boolean()
    .default(true)
    .description(
      localized({
        zh: "是否要 instruction 类注入（工作区指令、用法正文）：`false` 时丢掉官方 `agent-instructions` 的注入，并关掉通道自己的降级注入。",
        en: "Whether instruction-class injections apply (workspace instructions, guidance): `false` drops the official `agent-instructions` injection and turns off the channel's own demoted delivery.",
      }),
    ),
  skills: z.boolean().description(
    localized({
      zh: "是否要技能目录（官方 `skill-catalog` 的注入）。**不写就按这个模式自己的工具名单推导**：`(allowTools 留空 ? 全部 : allowTools) − denyTools` 里含 `skill` 就要；写 `false` 就丢掉官方 `skill-catalog` 的注入（`skill` 工具的可见性仍归 `allowTools`）。",
      en: "Whether the skill catalog applies (the official `skill-catalog` injection). Unset derives it from this mode's own tool lists: it applies when `(empty allowTools ? every tool : allowTools) − denyTools` contains `skill`; `false` drops the official `skill-catalog` injection (`skill` tool visibility still belongs to `allowTools`).",
    }),
  ),
  runtimeContext: z
    .boolean()
    .default(true)
    .description(
      localized({
        zh: "是否要动态快照（文件沙箱策略、审批策略）。",
        en: "Whether the runtime snapshot applies (sandbox and approval policy).",
      }),
    ),
  // 这个模式的默认模型。不标 `volatile`：`modes` 本身就是 volatile，整棵子树都在页面上——再标一层会被
  // schemastery 拒（`validateVolatileSchema` 不许 volatile 套 volatile）。
  defaultModel: modelSchema    // `default(null)` 是"没配就没有这个键"：schemastery 对缺省的对象字段会造一个空对象，那样每个模式都会
    // 凭空多出一行；给了 null 反而让它保持缺失（页面按非必填处理，从候选加成）。
    // 类型上放行一次：`null` 在这里只是"没有这个键"的写法，schema 的输入形状不接受它。
    .default(null as unknown as SessionModeModel)
    .description(
      localized({
        zh: "这个模式的默认模型；省略就跟全局默认模型。只在会话还没有模型事实时接管。",
        en: "Default model for this mode; unset follows the global default. Applies only while a session has no model fact yet.",
      }),
    ),
});

export const Config: z<Config, ResolvedConfig> = z.object({
  default: z
    .string()
    .required()
    .description(
      localized({
        zh: "新会话（还没选过模式的会话）用哪个模式；必须是下面 `modes` 里的一个 id。",
        en: "Mode a session starts in before anyone picks one; must be an id in `modes`.",
      }),
    )
    .volatile(),
  modes: z
    .dict(modeSchema)
    .required()
    .description(
      localized({
        zh:
          "模式清单：id → 定义（persona / 工具名单 / 生效的 policy 规则 / 角色）。改它对**已运行会话**不自动生效" +
          "——重挂后新建的会话、或重新应用模式的会话才用新定义。",
        en:
          "Mode roster: id to definition (persona, tool lists, effective policy rules, role). Edits do not follow " +
          "into already-running sessions; sessions created after the row is remounted use the new definition.",
      }),
    )
    .volatile(),
  // 退役字段：默认模型住在每个模式自己的 `defaultModel` 里。这里留着是为了**报错**（见 `configProblem`），
  // 页面上不出现（`hidden()`）。
  models: z.dict(modelSchema).default({}).hidden(),
});

// 校验只需要看的那几件事：默认模式、每个模式的角色、工具名单、policy 名单与默认模型。
interface Validated {
  readonly default: string;
  readonly modes: Readonly<
    Record<
      string,
      {
        // 留空合法的"不限制"；允许共享（差异由会话级收口表达），所以这里不做任何映射唯一性校验。
        readonly presetsOnly?: readonly string[];
        // 退役的单个 preset：还配着值就报错（它已经不再生效）。
        readonly preset?: string;
        // 留空合法：不设收窄（用 preset 的全部工具）。
        readonly allowTools?: readonly string[];
        // 留空合法：不禁任何工具；与 `allowTools` 同时命中合法（deny 优先）。
        readonly denyTools?: readonly string[];
        // 留空合法：不设技能收窄。
        readonly allowSkills?: readonly string[];
        // 留空合法：不禁任何技能；与 `allowSkills` 同时命中合法（deny 优先）。
        readonly denySkills?: readonly string[];
        // 留空合法：全部规则生效。
        readonly allowPolicies?: readonly string[];
        // 留空合法：一条都不禁；与 `allowPolicies` 同时命中合法（deny 优先）。
        readonly denyPolicies?: readonly string[];
        readonly role?: readonly string[];
        readonly defaultModel?: { readonly provider?: string; readonly model?: string };
      }
    >
  >;
  // 退役的顶层字段：还配着值就报错（它已经不再生效）。
  readonly models?: Readonly<Record<string, unknown>>;
}

// 已知的 policy 名（上游 waterfall 名）：写错的名字静默变成"没配"是这份配置最坏的失效方式，所以装配期拒绝。
const POLICY_NAME_SET: ReadonlySet<string> = new Set(POLICY_NAMES);

// 模式定义里不合法的地方（装配期 fail loud，而不是等到某个会话装配提示词时才发现）。
export function configProblem(config: Validated): string | undefined {
  // 没写 `role` 等于默认 `["main"]`（与 schema 的默认一致）——字面量与归一化后的形状都能校验。
  const roles = (id: string): readonly string[] => config.modes[id]?.role ?? ["main"];
  const ids = Object.keys(config.modes);
  if (ids.length === 0) return "session-mode: `modes` must declare at least one mode";
  if (!ids.includes(config.default)) {
    return `session-mode: \`default\` names ${JSON.stringify(config.default)}, which is not in modes (${ids.join(", ")})`;
  }
  const roleless = ids.filter((id) => roles(id).length === 0);
  if (roleless.length > 0) {
    return `session-mode: mode(s) ${roleless.join(", ")} declare no \`role\`; declare main and/or subagent instead of leaving it empty`;
  }
  if (!roles(config.default).includes("main")) {
    return `session-mode: \`default\` names ${JSON.stringify(config.default)}, which does not declare role "main"; a session that can never be re-selected is a contradiction`;
  }
  // 每个模式列出的 policy 名都必须在已知名单里（名单见 `shared.ts` 的 `POLICY_NAMES`）。`denyTools` 与
  // `allowTools` 同时命中是**合法**的（deny 优先）：这里不报错，只拒绝认不出的名字。
  const unknownPolicies = Object.entries(config.modes).flatMap(([id, mode]) =>
    [...(mode.allowPolicies ?? []), ...(mode.denyPolicies ?? [])]
      .filter((policy) => !POLICY_NAME_SET.has(policy))
      .map((policy) => `${id}: ${policy}`),
  );
  if (unknownPolicies.length > 0) {
    return `session-mode: mode(s) ${unknownPolicies.join(", ")} name unknown policies; the known ones are ${POLICY_NAMES.join(", ")}`;
  }
  // `allowTools` **留空是合法的**：不设收窄，用这个会话挂着的 preset 的全部工具。
  // `presetsOnly` **允许留空**（不限制会话挂哪份 preset）**也允许共享**（共享时 preset → 模式的反查交给
  // `SessionModes.modeForPreset`）；退役的顶层 `models` 还配着值就报错——别让一份"看着像配过"的配置静静地失效。
  if (Object.keys(config.models ?? {}).length > 0) {
    return "session-mode: `models` has moved into each mode's `defaultModel`; move the entries there and drop the top-level `models`";
  }
  // 退役的单个 `preset`（现在是白名单 `presetsOnly`）：旧写法照旧"看着像配过"却不再生效，所以装配期拒绝。
  const retiredPresets = Object.entries(config.modes)
    .filter(([, mode]) => mode.preset !== undefined)
    .map(([id]) => id);
  if (retiredPresets.length > 0) {
    return `session-mode: mode(s) ${retiredPresets.join(", ")} still declare \`preset\`; it has moved to \`presetsOnly\` (the presets that mode may ride on)`;
  }
  // 每个模式自己的默认模型：成对给全（`provider` 与 `model` 都要）。
  const partial = Object.entries(config.modes)
    .filter(([, mode]) => {
      const model = mode.defaultModel;
      if (model === undefined) return false;
      return (
        model.provider === undefined ||
        model.model === undefined ||
        model.provider.length === 0 ||
        model.model.length === 0
      );
    })
    .map(([id]) => id);
  if (partial.length > 0) {
    return `session-mode: mode(s) ${partial.join(", ")} declare \`defaultModel\` without both \`provider\` and \`model\``;
  }
  return undefined;
}
