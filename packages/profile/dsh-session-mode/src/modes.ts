/**
 * 模式的**定义形状**与它的装配期校验：一个模式就是"一段提示词 + 一组能力开关"。
 *
 * 与旧形态（每个模式一行 `@deepseek-ai/dsh-agent-preset`，`config.plugins` 里塞 persona / scope 行）的区别：
 * 模式不再是 Cordis 子树，而是这份纯数据——本包的插件行只在 `config.modes` 里声明它们，运行期按会话读取
 * 并应用（persona 注册到该 agent 的 scope，工具收口交给 `@morlay/dsh-context-assembler/scope`）。
 *
 * "支持自定义"就是指这份 config：装配层（`cordis.patch.yml` / profile 的用户层）能整体改写 `modes`，
 * 也可以只给某几个模式换提示词或白名单——不需要任何插件行。
 */

import z from "@deepseek-ai/schemastery";

/** 一个模式的提示词：两段文本，注册成 agent 作用域的 `deployment:persona-prefix` / `-suffix` section。 */
export interface SessionModePersona {
  /** 系统提示词最前的一段；空串表示不遮蔽部署级那层。 */
  readonly prefix: string;
  /** 系统提示词最后的一段；空串表示不写。 */
  readonly suffix: string;
}

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
const personaSchema = z.object({
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});

/** 本包的 config：默认模式 + 模式清单。 */
export interface Config {
  /** 新会话（还没选过模式的会话）用哪个模式。必须是 `modes` 里的一个 id。 */
  readonly default: string;
  /** 模式清单：id → 定义。顺序即选择器里的顺序（`Object.entries` 的插入序）。 */
  readonly modes: Record<string, SessionMode>;
}

const modeSchema: z<SessionMode> = z.object({
  name: z.string().required(),
  description: z.string().default(""),
  persona: personaSchema.default({}),
  allowTools: z.array(z.string()).default([]),
  instructions: z.boolean().default(true),
  runtimeContext: z.boolean().default(true),
});

export const Config: z<Config> = z.object({
  default: z.string().required(),
  modes: z.dict(modeSchema).required(),
});

/** 校验只需要看的两件事：默认模式与每个模式的工具名单。 */
interface Validated {
  readonly default: string;
  readonly modes: Readonly<Record<string, { readonly allowTools?: readonly string[] }>>;
}

/** 模式定义里不合法的地方（装配期 fail loud，而不是等到某个会话装配提示词时才发现）。 */
export function configProblem(config: Validated): string | undefined {
  const ids = Object.keys(config.modes);
  if (ids.length === 0) return "session-mode: `modes` must declare at least one mode";
  if (!ids.includes(config.default)) {
    return `session-mode: \`default\` names ${JSON.stringify(config.default)}, which is not in modes (${ids.join(", ")})`;
  }
  const empty = ids.filter((id) => (config.modes[id]?.allowTools ?? []).length === 0);
  if (empty.length > 0) {
    return `session-mode: mode(s) ${empty.join(", ")} declare no \`allowTools\`; list the tools instead of leaving it empty`;
  }
  return undefined;
}
