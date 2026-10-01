// 按**会话**收口：一份模式定义落成这个会话的工具面与三个开关。收口的输入就是模式定义、唯一消费者也是模式，所以
// 它住在本包（`SessionModes.installFor` 直接调 `apply`），不发布任何服务、不认识 config 与页面。
//
// `apply` 落到这个 agent 身上四件事：
//
// - **装配期投影**：模型目录与 `tool:<工具名>` section 按同一份合成结果过滤；
// - **执行层 guard**（在 `agent.ctx` 的 `tools` inject 回调里）：拒绝时给该模式的文案，并说得出是哪一类（白名单外 /
//   黑名单内）；
// - **两个抑制面**（`agent/pre-step`）：官方 `agent-instructions` 与 `skill-catalog` 的注入按开关丢掉——官方那两行
//   在装配投影之外自己往瀑布里 append，只能在瀑布上丢（不动注册表、也不动它们的行）；
// - **另两个开关**（注入面那个 `skills` 在上面那条里）：`runtimeContext: false` 抑制动态快照
//   （`systemPrompt.suppressRuntimeContext`），`instructions: false` 关掉通道自己的降级注入
//   （`ctx.contextAssembler.setInstructions`）。
//
// 同一个 agent 再 `apply` 就是换一份（旧 disposer 全部收回）；不走 `tools.restrict()`（会触发 `tools/change`），
// 也不建 preset 子树。

import { type Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
// 技能目录那条消息的 `source` 形状由官方 `tool-skill` 行声明（`MessageSourceMap` 的合并扩展）：这里只借它的类型，
// 认它仍是按 `kind` 字符串读——运行期不依赖那一行在场。
import type {} from "@deepseek-ai/dsh-tool-skill";
// 通道的服务声明（`ctx.contextAssembler`）住在 `@morlay/dsh-context-assembler` 的包根上；那是可选搭档，
// 所以只借它的类型，取服务仍按"可能没有"处理。
import type {} from "@morlay/dsh-context-assembler";

// 一次收口的全部输入：模式定义里本文件用到的那几项（`SessionModes.installFor` 解析之后整份推过来）。
export interface SessionScopeDefinition {
  // 拒绝对话时用的模式名。
  readonly name: string;
  // 这个会话能用的工具；其余既不进目录，调用也被拒。**留空表示不设白名单**——起点是全部工具。
  readonly allowTools: readonly string[];
  // 这个会话明确排除的工具。与 `allowTools` 同时命中一个名字时**黑名单优先**（拒，且文案说黑名单）。
  readonly denyTools: readonly string[];
  // 这个会话能用的技能；其余既不进技能目录，`skill` 工具加载它也被拒。**留空表示不设白名单**——起点是全部技能。
  readonly allowSkills: readonly string[];
  // 这个会话明确排除的技能。与 `allowSkills` 同时命中一个名字时**黑名单优先**（拒，且文案说黑名单）。
  readonly denySkills: readonly string[];
  // 这个会话要不要 instruction 类注入（`false` → 丢掉官方 `agent-instructions` 的注入，并关通道的降级注入）。
  readonly instructions: boolean;
  // 这个会话要不要技能目录（`false` → 丢掉官方 `skill-catalog` 的注入）。
  readonly skills: boolean;
  // 这个会话要不要动态快照（`false` → 按 scope 抑制）。
  readonly runtimeContext: boolean;
}

// 一条工具被拒的两类原因：白名单外 / 黑名单内。文案要能看出是哪一类，模型才知道怎么绕（换工具还是换模式）。
type Denial = "not-allowlisted" | "denylisted";

const OUT_OF_SCOPE = (toolName: string, modeName: string): string =>
  `${toolName} 不在「${modeName}」的工具白名单里，用它不会有结果；按当前模式提供的工具完成任务，或让用户切到别的模式。`;

const DENYLISTED = (toolName: string, modeName: string): string =>
  `${toolName} 被「${modeName}」的工具黑名单排除，用它不会有结果；按当前模式提供的工具完成任务，或让用户切到别的模式。`;

function refusalOf(toolName: string, modeName: string, denial: Denial): string {
  return denial === "denylisted"
    ? DENYLISTED(toolName, modeName)
    : OUT_OF_SCOPE(toolName, modeName);
}

// 技能被拒的两类原因：同一套白名单 / 黑名单语义，文案换到技能面（拒绝加载某一件技能，而不是某个工具）。
const SKILL_OUT_OF_SCOPE = (skillName: string, modeName: string): string =>
  `${skillName} 不在「${modeName}」的技能白名单里，加载它不会有结果；按当前模式可用的技能完成任务，或让用户切到别的模式。`;

const SKILL_DENYLISTED = (skillName: string, modeName: string): string =>
  `${skillName} 被「${modeName}」的技能黑名单排除，加载它不会有结果；按当前模式可用的技能完成任务，或让用户切到别的模式。`;

function skillRefusalOf(skillName: string, modeName: string, denial: Denial): string {
  return denial === "denylisted"
    ? SKILL_DENYLISTED(skillName, modeName)
    : SKILL_OUT_OF_SCOPE(skillName, modeName);
}

// 单个工具的说明 section 名前缀：`tool:<工具名>`（`tools:` 那类是聚合块，不归收口管）。
const TOOL_SECTION_PREFIX = "tool:";

// 加载技能的那个官方工具名：官方 `tool-skill` 行的注册名，本包不 import 那一行（依赖面只到服务），所以按字符串读
// ——与 `kindOf` 读官方注入面同一做法。
const SKILL_TOOL_NAME = "skill";

// 一次收口**合成**出来的一份名单面：最终可用 = (白名单留空 ? 全部 : 白名单) − 黑名单。工具面与技能面同形：
// 两处（装配投影 / 执行 guard）都读同一个合成结果。
type NameGate = {
  // undefined = 不设白名单（全部都是起点）。
  readonly allow: ReadonlySet<string> | undefined;
  readonly deny: ReadonlySet<string>;
};

function gateOfNames(allow: readonly string[], deny: readonly string[]): NameGate | undefined {
  const denied = new Set(deny);
  const allowed = allow.length === 0 ? undefined : new Set(allow);
  if (allowed === undefined && denied.size === 0) return undefined;
  return { allow: allowed, deny: denied };
}

// 判定一个名字：`undefined` = 放行，否则是被拒的原因（黑名单先判，于是 deny 优先）。
function denialOf(gate: NameGate, name: string): Denial | undefined {
  if (gate.deny.has(name)) return "denylisted";
  if (gate.allow !== undefined && !gate.allow.has(name)) return "not-allowlisted";
  return undefined;
}

// 一条消息来自谁：官方那两个 kind（`agent-instructions` / `skill-catalog`）由各自的行在自己模块里声明，本包不
// import 它们，所以按字符串读——认不出的一律不算抑制面。
function kindOf(message: UserMessage): string | undefined {
  const kind = (message.source as { readonly kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

// 技能目录正文里的条目行：`- \`<技能名>\`: <说明>`（官方 `tool-skill` 的渲染形状）。只认行首这一种，
// 认不出的行一律原样留着——宁可多列，不可把别的东西删掉。
const CATALOG_LINE = /^- `([^`]+)`: /u;

// 按技能名单收窄一条 `skill-catalog` 消息：正文删掉被拒技能那几行，`source.entries` 同步剔除。
// `undefined` = 这条消息不用动（名单没排除它任何一项，或者形状认不出）。
function narrowCatalog(
  message: UserMessage,
  gate: NameGate,
  warn: (line: string) => void,
): UserMessage | undefined {
  const source = message.source;
  if (source.kind !== "skill-catalog") return undefined;
  const entries = source.entries;
  const denied = new Set(
    entries.map((entry) => entry.name).filter((name) => denialOf(gate, name) !== undefined),
  );
  if (denied.size === 0) return undefined;

  const [block, ...rest] = message.content;
  if (block?.type !== "text" || rest.length > 0) {
    warn(
      `skill catalog message is not one text block; denied skills stay listed: ${[...denied].join(", ")}`,
    );
    return undefined;
  }
  const removed = new Set<string>();
  const lines = block.text.split("\n").filter((line) => {
    const match = CATALOG_LINE.exec(line);
    if (match === null) return true;
    const name = match[1] ?? "";
    if (!denied.has(name)) return true;
    removed.add(name);
    return false;
  });
  // 上游渲染形状漂移：正文里没定位到这些名字。这一条**整条不动**（正文与结构化名单保持一致：宁可多列，
  // 不可出现"正文里有、名单里没有"的分叉），但要点出来——这条名单面就靠这行告警才不算静默失灵。
  const missing = [...denied].filter((name) => !removed.has(name));
  if (missing.length > 0) {
    warn(`skill catalog lines not recognized; denied skills stay listed: ${missing.join(", ")}`);
    return undefined;
  }
  return {
    ...message,
    content: [{ ...block, text: lines.join("\n") }],
    source: { ...source, entries: entries.filter((entry) => !denied.has(entry.name)) },
  };
}

// `skill` 工具调用的技能名：参数形状是官方那一行的 `{ name: string }`，认不出就不判（那是别人的工具）。
function skillNameOf(arguments_: unknown): string | undefined {
  if (typeof arguments_ !== "object" || arguments_ === null) return undefined;
  const name = (arguments_ as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

// 一个 agent 当前装着的那一份：`apply` 时解析好的开关（抑制面读它）。
interface Applied {
  // 两条名单都空 = 不过滤（装配期与执行层都放行）。
  readonly gate: NameGate | undefined;
  // 技能面的名单：与工具面同形，`undefined` = 不设收窄（目录照旧、`skill` 工具不按名判）。
  readonly skillGate: NameGate | undefined;
  readonly instructions: boolean;
  readonly skills: boolean;
  // 收回这一份在 `agent.ctx` 上的注册（抑制器与执行层 guard）。
  readonly dispose: () => void;
}

// 按会话收口工具面与注入面的状态机：一份 per-agent 的状态 + 两条全局监听器。
export class SessionScope {
  private readonly applied = new WeakMap<Agent, Applied>();
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
    // 装配期过滤：这里只认已经 `apply` 过的会话；没登记过的（没装模式那层的部署）一律放行。
    ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
      const agent = context.agent;
      const applied = agent === undefined ? undefined : this.applied.get(agent);
      if (applied === undefined || applied.gate === undefined) return next();
      const gate = applied.gate;
      const result = await next();
      return {
        ...result,
        // 工具自己的说明 section 与工具目录同源：目录里没有的工具，它的说明也不该留在提示词里。
        sections: result.sections.filter((section) =>
          section.name.startsWith(TOOL_SECTION_PREFIX)
            ? denialOf(gate, section.name.slice(TOOL_SECTION_PREFIX.length)) === undefined
            : true,
        ),
        tools: result.tools.filter((tool) => denialOf(gate, tool.name) === undefined),
      };
    });

    // 两个抑制面：官方 `agent-instructions`（工作区指令）与官方 `skill-catalog`（技能目录）都在装配投影之外自己
    // 往这条瀑布里 append，所以只有在这里丢掉它们的条目（技能名单则在这里把目录按名收窄）。
    //
    // `prepend` 是必需的：官方那两行比本行早注册（会话挂着的 preset 先于 host 平面），瀑布里先注册的是**外层**，
    // 站在它们后面就看不到、也丢不掉它们 append 的条目——只有抢在最外层（`await next()` 之后再收）才拿得到最终
    // 消息表。
    ctx.on(
      "agent/pre-step",
      async (payload, next): Promise<PreStepDecision> => {
        const decision = await next();
        if (decision.kind !== "enter") return decision;
        const applied = this.applied.get(payload.agent);
        // 没收过口的会话一律不动。
        if (applied === undefined) return decision;
        let changed = false;
        const kept: UserMessage[] = [];
        for (const message of decision.messages) {
          const kind = kindOf(message);
          if (kind === "agent-instructions") {
            if (applied.instructions) kept.push(message);
            else changed = true;
            continue;
          }
          if (kind === "skill-catalog") {
            if (!applied.skills) {
              changed = true;
              continue;
            }
            const narrowed =
              applied.skillGate === undefined
                ? undefined
                : narrowCatalog(message, applied.skillGate, (line) =>
                    this.ctx.logger.warn(`session-mode: ${line}`),
                  );
            if (narrowed === undefined) kept.push(message);
            else {
              changed = true;
              kept.push(narrowed);
            }
            continue;
          }
          kept.push(message);
        }
        return changed ? { ...decision, messages: kept } : decision;
      },
      { prepend: true },
    );
  }

  // 把某个会话收口到这份定义上（同一个 agent 再调就是换一份）。
  apply(agent: Agent, definition: SessionScopeDefinition): void {
    const previous = this.applied.get(agent);
    if (previous !== undefined) previous.dispose();
    // 两份名单都空 = 不过滤：没有守卫要装，装配期也一路放行。
    const gate = gateOfNames(definition.allowTools, definition.denyTools);
    const skillGate = gateOfNames(definition.allowSkills, definition.denySkills);

    // 落在 `agent.ctx` 上的那两件用一个 effect 装：动态快照抑制是 scope 层的一次注册；执行层 guard 要等
    // `tools` 激活才装得上（`inject` 的回调），它挂在那个 inject fiber 下，所以收回时连 fiber 一起收。
    const dispose = agent.ctx.effect(() => {
      const stoppers: (() => void)[] = [];
      if (definition.runtimeContext === false) {
        // service 在 `agent.ctx` 上是 shadow：抑制落在该 agent 的 scope 层，只覆盖这个会话。
        stoppers.push(agent.ctx.systemPrompt.suppressRuntimeContext());
      }
      // 必须落在 `agent.ctx` 上才是这个会话的作用域。
      const fiber = agent.ctx.inject(["tools"], (scope) => {
        if (gate === undefined && skillGate === undefined) return;
        scope.tools.guard((exec) => {
          // 工具面：按名判这个工具本身能不能用。
          const denial = gate === undefined ? undefined : denialOf(gate, exec.name);
          if (denial !== undefined) return refusalOf(exec.name, definition.name, denial);
          // 技能面：`skill` 工具本身照旧可用，被收窄的是它这次要加载的那一件技能。
          if (skillGate === undefined || exec.name !== SKILL_TOOL_NAME) return undefined;
          const skillName = skillNameOf(exec.arguments);
          if (skillName === undefined) return undefined;
          const skillDenial = denialOf(skillGate, skillName);
          return skillDenial === undefined
            ? undefined
            : skillRefusalOf(skillName, definition.name, skillDenial);
        });
      });
      return [...stoppers, () => fiber.dispose()];
    }, "session-mode: per-session gate");

    // 通道那一侧的降级注入按 agent 覆盖，不需要收回。
    this.channel()?.setInstructions(agent, definition.instructions);

    this.applied.set(agent, {
      gate,
      skillGate,
      instructions: definition.instructions,
      skills: definition.skills,
      dispose,
    });
  }

  // 通道是可选的搭档：没有它就没有降级注入可关，工具面与两个抑制面照常生效。
  private channel(): { setInstructions(agent: Agent, on: boolean): void } | undefined {
    try {
      return this.ctx.get("contextAssembler");
    } catch {
      return undefined;
    }
  }
}
