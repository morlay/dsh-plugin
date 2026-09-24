/**
 * 模式的**定义形状**与它的装配期校验：一个模式就是"一段提示词 + 一组能力开关"。
 *
 * 与旧形态（每个模式一行 `@deepseek-ai/dsh-agent-preset`，`config.plugins` 里塞 persona / scope 行）的区别：
 * 模式不再是 Cordis 子树，而是这份纯数据——本包的插件行只在 `config.modes` 里声明它们，运行期按会话读取
 * 并应用（persona 注册到该 agent 的 scope，工具收口交给 `@morlay/dsh-context-assembler/scope`）。
 *
 * "支持自定义"就是指这份 config：装配层（`cordis.patch.yml` / profile 的用户层）能整体改写 `modes`，
 * 也可以只给某几个模式换提示词或白名单——不需要任何插件行。
 *
 * "某个模式默认用哪个模型"**不在**模式里，而是 config 的顶层 `models`（模式 id → 模型）：它是 settings
 * 的设置面要编辑的东西，而设置面只认 volatile 字段、且只认**固定路径**（dict 内部的字段一律 blocked，见
 * `@deepseek-ai/schemastery` 的 `validateVolatileSchema`）。取舍与理由见
 * [ADR 模式默认模型搬到顶层 volatile](../.agents/adrs/20260925-模式默认模型搬到顶层volatile.md)。
 */

import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

/** 一个模式的提示词：两段文本，注册成 agent 作用域的 `deployment:persona-prefix` / `-suffix` section。 */
export interface SessionModePersona {
  /** 系统提示词最前的一段；空串表示不遮蔽部署级那层。 */
  readonly prefix: string;
  /** 系统提示词最后的一段；空串表示不写。 */
  readonly suffix: string;
}

/**
 * 一个模式对谁可见：`main` 进用户选择器（会话级选择），`subagent` 表示它**可以**作为子代理的 mode。
 * 两个角色可以同时声明；不写默认 `["main"]`——没写角色的模式不该悄悄变成子代理候选。
 *
 * `subagent` 目前只是候选集的声明：子代理默认继承父 mode（不看角色），"按角色指派 mode" 还没做。
 */
export type SessionModeRole = "main" | "subagent";

/** 一个模式的默认模型；省略的字段跟着 provider 默认走（与全局 `agent-default-model` 同形状）。 */
export interface SessionModeModel {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** 各模式的默认模型：模式 id → 模型；键必须在 `modes` 里（装配期校验）。 */
export type SessionModeModels = Readonly<Record<string, SessionModeModel>>;

/**
 * 一个模式：提示词 + 能力开关。
 *
 * 这份形状是 **schema 归一化之后**的：每个字段都有值（写配置时可以不写，schema 用默认补上——`description`
 * 补空串、`persona` 补两段空文本、两个布尔开关补 `true`）。配置里能省略哪些字段看 `modeSchema` 的 default，
 * 不看这里。
 */
export interface SessionMode {
  /** 选择器里的展示名。 */
  readonly name: string;
  /** 一句话说明这个模式干什么；空串表示没写。 */
  readonly description: string;
  /** 这个模式归谁用：`main`（用户选择器）/ `subagent`（可作子代理 mode）。至少一个。 */
  readonly role: SessionModeRole[];
  /** 该模式的提示词。 */
  readonly persona: SessionModePersona;
  /**
   * 这个模式能用哪些工具；其余工具既不进模型目录、调用也被执行层拒绝，它们自己的说明 section
   * （`tool:<工具名>`）也不留在提示词里。**至少给一个**——想要"全都要"就列出全部，别留空。
   */
  readonly allowTools: string[];
  /**
   * 是否要 instruction 类注入（工作区指令、技能目录、用法正文）。缺省要；`false` 表示这个模式一条都不要
   * ——对话模式就是它。开关由 `@morlay/dsh-context-assembler/scope` 落到通道上。
   */
  readonly instructions: boolean;
  /**
   * 是否要 runtime context（文件沙箱策略、审批策略那两条动态快照）。缺省要；`false` 表示这个模式不要它们
   * ——对话模式没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音。
   */
  readonly runtimeContext: boolean;
}

// 每个字段都带 default：schema 的产物因此没有 `undefined` 键（`exactOptionalPropertyTypes` 下"缺省的键"
// 会与可选属性对不上），而默认值就是"不遮蔽"的那个语义——persona 的默认是两段空文本。
/**
 * 本地化说明：`description()` 的类型签名只声明 `string`，而 meta 本身接受 `Dict<string>`
 * （`vendor/schemastery/src/index.ts` 的 `mergeDesc` 就是按字典合并的），所以这里只做一次类型放行。
 */
const localized = (text: { zh: string; en: string }): string => text as unknown as string;

const personaSchema = z.object({
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});

/** 角色是个封闭集合：写错的 role 在装配期就拒绝，而不是静默变成"谁都不用"。 */
const roleSchema = z.union([z.const("main"), z.const("subagent")]);

/** 默认模型的形状与全局 `agent-default-model` 一致；省略 effort 就跟 provider 默认。 */
const modelSchema = z.object({
  provider: z
    .string()
    .required()
    .role("select")
    .description(
      localized({
        zh: "服务商 id（`llm-openai-compatible` 的 providers 里的键，或内置服务商名）。",
        en: "Provider id: a key in `llm-openai-compatible`'s providers, or a built-in provider name.",
      }),
    ),
  model: z
    .string()
    .required()
    .role("select")
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

/** 本包 config 的**源码形状**：装配层与设置页写的那个形状（`models` 是普通对象，可以整块省略）。 */
export interface Config {
  /** 新会话（还没选过模式的会话）用哪个模式。必须是 `modes` 里的一个 id。 */
  readonly default: string;
  /** 模式清单：id → 定义。顺序即选择器里的顺序（`Object.entries` 的插入序）。 */
  readonly modes: Record<string, SessionMode>;
  /**
   * 各模式的默认模型：模式 id → 模型。省略的模式跟着全局 `agent-default-model` 走。
   *
   * 它是 config 的**顶层 volatile 字段**：设置面（`ctx.configForms` → 我们那张卡片）编辑的就是它。挪进
   * `modes.<id>` 会让设置面看不见它——`schemastery` 的 `validateVolatileSchema` 把 dict 内部一律当成
   * blocked，而 settings 只挑得出固定路径上的 volatile 字段。
   */
  readonly models?: SessionModeModels;
}

/**
 * schema 解析之后的形状：volatile 字段被换成**稳定引用**，读它要过 `.get()`（设置页改的就是同一份）。
 *
 * 三个字段都是 volatile：模式清单、默认模式与各模式默认模型都在行配置页上（见 `Config`）。
 */
export interface ResolvedConfig {
  readonly default: Volatile<string>;
  readonly modes: Volatile<Record<string, SessionMode>>;
  /** 各模式的默认模型；一个都没配时是空对象（schema 的 default）。 */
  readonly models: Volatile<SessionModeModels>;
}

const modeSchema: z<SessionMode> = z.object({
  name: z
    .string()
    .required()
    .description(
      localized({
        zh: "展示名（模式选择器里显示的）。",
        en: "Display name shown in the mode picker.",
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
        zh: "这个会话能用的工具；其余既不进目录，调用也被拒。",
        en: "Tools this session may use; everything else leaves the catalog and calls are refused.",
      }),
    ),
  instructions: z
    .boolean()
    .default(true)
    .description(
      localized({
        zh: "是否要 instruction 类注入（工作区指令、技能目录、用法正文）。",
        en: "Whether instruction-class injections apply (workspace instructions, skill catalog, guidance).",
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
          "模式清单：id → 定义（persona / 允许的工具 / 角色）。改它对**已运行会话**不自动生效——重挂后新建的会话、" +
          "或重新应用模式的会话才用新定义。",
        en:
          "Mode roster: id to definition (persona, allowed tools, role). Edits do not follow into already-running " +
          "sessions; sessions created after the row is remounted use the new definition.",
      }),
    )
    .volatile(),
  models: z
    .dict(modelSchema)
    .default({})
    .description(
      localized({
        zh: "各模式的默认模型；留空就跟全局默认模型。",
        en: "Default model per mode; unset follows the global default model.",
      }),
    )
    .volatile(),
});

/** 校验只需要看的那几件事：默认模式、每个模式的工具名单与角色、配了的默认模型。 */
interface Validated {
  readonly default: string;
  readonly modes: Readonly<
    Record<
      string,
      {
        readonly allowTools?: readonly string[];
        readonly role?: readonly string[];
      }
    >
  >;
  /** 配了的默认模型；省略等于"一个都没配"（源码形状与解析后的形状都能校验）。 */
  readonly models?: Readonly<
    Record<string, { readonly provider?: string; readonly model?: string }>
  >;
}

/** 模式定义里不合法的地方（装配期 fail loud，而不是等到某个会话装配提示词时才发现）。 */
export function configProblem(config: Validated): string | undefined {
  /** 没写 `role` 等于默认 `["main"]`（与 schema 的默认一致）——字面量与归一化后的形状都能校验。 */
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
  const empty = ids.filter((id) => (config.modes[id]?.allowTools ?? []).length === 0);
  if (empty.length > 0) {
    return `session-mode: mode(s) ${empty.join(", ")} declare no \`allowTools\`; list the tools instead of leaving it empty`;
  }
  // `models` 的键是模式 id：写错一个就成了"配了但永远不会生效"的孤儿，装配期就得看见。
  const unknown = Object.keys(config.models ?? {}).filter((id) => !ids.includes(id));
  if (unknown.length > 0) {
    return `session-mode: \`models\` names unknown mode(s) ${unknown.join(", ")}; available are ${ids.join(", ")}`;
  }
  const partial = Object.entries(config.models ?? {})
    .filter(
      ([, model]) =>
        model.provider === undefined ||
        model.model === undefined ||
        model.provider.length === 0 ||
        model.model.length === 0,
    )
    .map(([id]) => id);
  if (partial.length > 0) {
    return `session-mode: mode(s) ${partial.join(", ")} declare \`models\` without both \`provider\` and \`model\``;
  }
  return undefined;
}
