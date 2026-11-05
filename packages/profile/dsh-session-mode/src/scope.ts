// 按**会话**收口：一份模式定义落成这个会话的工具面与三个开关。收口的输入就是模式定义、唯一消费者也是模式，所以
// 它住在本包（`SessionModes.installFor` 直接调 `apply`），不发布任何服务、不认识 config 与页面。
//
// `apply` 落到这个 agent 身上四件事：
//
// - **工具面**（`agent.ctx.tools.restrict()`）：目录与执行走同一个视图——收窄掉的工具既不在模型目录里，
//   调用也直接是 `UNKNOWN_TOOL`（上游 0.2.1-rc.2 起工具声明不再经 `system-prompt/assemble`，那里只剩
//   sections / contexts / variables，所以只能落在注册表视图上；取舍见 `../.agents/adrs/20261026-工具面收窄改用tools.restrict.md`）；
// - **`tool:<工具名>` section**：装配瀑布里按同一份名单过滤（工具自己的说明与目录同源）；
// - **执行层 guard**：只留给技能面——`skill` 工具本身照旧可用，被收窄的是它这次要加载的那一件技能；
// - **三个抑制面**（`agent/pre-step`）：官方 `agent-instructions`、`skill-catalog` 与 `time-context` 的注入按开关
//   丢掉——官方那几行在装配投影之外自己往瀑布里 append，只能在瀑布上丢（不动注册表、也不动它们的行）；
// - **另两个开关**（注入面那个 `skills` 在上面那条里）：`runtimeContext: false` 抑制动态快照
//   （`systemPrompt.suppressRuntimeContext`）与时钟那条注入（`agent/pre-step` 上的 `time-context`），
//   `instructions: false` 关掉通道自己的降级注入（`ctx.contextAssembler.setInstructions`）。
//
// 同一个 agent 再 `apply` 就是换一份（旧 disposer 全部收回）；不建 preset 子树。

import { type Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { groupTools } from "./tool-groups.ts";
import { refGroup, toolGroupOf } from "./shared.ts";
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
  // 会话级逐条目三态里"允许"的那些（组引用展开之后单独放回来）。
  readonly allowToolsOverride?: readonly string[];
  // 会话级逐条目三态里"禁止"的那些。
  readonly denyToolsOverride?: readonly string[];
  // 这个会话能用的技能；其余既不进技能目录，`skill` 工具加载它也被拒。**留空表示不设白名单**——起点是全部技能。
  readonly allowSkills: readonly string[];
  // 这个会话明确排除的技能。与 `allowSkills` 同时命中一个名字时**黑名单优先**（拒，且文案说黑名单）。
  readonly denySkills: readonly string[];
  // 这个会话要不要 instruction 类注入（`false` → 丢掉官方 `agent-instructions` 的注入，并关通道的降级注入）。
  readonly instructions: boolean;
  // 这个会话要不要技能目录（`false` → 丢掉官方 `skill-catalog` 的注入）。
  readonly skills: boolean;
  // 这个会话要不要动态快照（`false` → 按 scope 抑制，并在瀑布上丢掉时钟那条注入）。
  readonly runtimeContext: boolean;
}

// 一条工具被拒的两类原因：白名单外 / 黑名单内。技能面文案用（工具面被收窄后不走这里，调用直接是
// `UNKNOWN_TOOL`——见头注释）。
type Denial = "not-allowlisted" | "denylisted";

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

// 归"动态快照"的两条 harness 平台说明 section（实现检出路径、Web GUI 朝向）。它们由上游
// `harness-dev-context` 注册，`suppressRuntimeContext()` 管不到 section，只能在这里丢。
const RUNTIME_SECTIONS: ReadonlySet<string> = new Set(["harness:source", "app:web-surface"]);

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
  // **只改正文**，`source.entries` 原样留着：官方 `tool-skill` 用那份结构化名单的 digest 判断"目录变没变"
  // （`catalogHistory` 从会话日志里读它），改了它 digest 就永远对不上，于是每一步都重发一条目录。
  // 收窄是"模型看到什么"，不是"官方发布过什么"：日志里留的是官方发布的完整名单，模型可见面由正文承担。
  return { ...message, content: [{ ...block, text: lines.join("\n") }] };
}

// `skill` 工具调用的技能名：参数形状是官方那一行的 `{ name: string }`，认不出就不判（那是别人的工具）。
function skillNameOf(arguments_: unknown): string | undefined {
  if (typeof arguments_ !== "object" || arguments_ === null) return undefined;
  const name = (arguments_ as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

// 组引用的三种写法都认：`mcp:<server>` / `group:<id>`，以及省掉前缀的裸名。
function matchGroup(
  groups: ReadonlyMap<string, readonly string[]>,
  raw: string,
): { name: string; tools: readonly string[] } | undefined {
  for (const candidate of [raw, `mcp:${raw}`, `group:${raw}`]) {
    const tools = groups.get(candidate);
    if (tools !== undefined) return { name: candidate, tools };
  }
  return undefined;
}

// 一个 agent 当前装着的那一份：装配期过滤读它（`apply` 时解析好的名单）。
interface Applied {
  // 两条名单都空且没有待放行的按需组 = 不过滤（装配期与执行层都放行）。组引用在拿到工具名全集后展开，
  // 所以它是可替换的：`tool_group_load` 放行一组后会按新的按需面重算。
  gate: NameGate | undefined;
  // 展开后的两条名单：重算 `gate` 的底稿（按需面变了，显式名单不变）。
  readonly allowExpanded: readonly string[];
  readonly denyExpanded: readonly string[];
  // 工具名全集：判断某个 MCP server 的指令还要不要留在提示词里。
  readonly known: readonly string[];
  // 这个会话要不要动态快照（`false` 时把 harness 的平台说明 section 一并去掉）。
  readonly runtimeContext: boolean;
  // 收回这一份在 `agent.ctx` 上的注册（抑制器与执行层 guard）。
  readonly dispose: () => void;
}

// 一个会话当前的工具面：名字全集、模式自己的黑名单、按需分组，以及那次 `restrict` 的收回句柄。
// `restrict` 会随"放行一组"重建，所以它单独存，不跟控制工具一起收。
interface ToolFace {
  // 放行一组时要回写这个 agent 的装配期名单（说明 section 与目录同源）。
  readonly agent: Agent;
  readonly known: readonly string[];
  readonly baseDeny: ReadonlySet<string>;
  readonly groups: ReadonlyMap<string, readonly string[]>;
  readonly allowOverride: ReadonlySet<string>;
  readonly denyOverride: ReadonlySet<string>;
  disposeRestriction?: (() => void) | undefined;
}

// 按会话收口工具面与注入面的状态机：一份 per-agent 的装配期名单 + 挂在各 agent 上的注册。
export class SessionScope {
  private readonly applied = new WeakMap<Agent, Applied>();
  // 会话内已放行的 MCP 组（换模式重建工具面时保留）。
  private readonly activatedGroups = new WeakMap<Agent, Set<string>>();
  // 会话当前的工具面（名字全集、基础黑名单、分组与 restrict 句柄）。
  private readonly faces = new WeakMap<Agent, ToolFace>();
  // 全量工具目录（第一次收口前抓，之后复用）：面板要的 id + 描述。
  private readonly catalogs = new WeakMap<
    Agent,
    readonly { name: string; description: string }[]
  >();
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
    // 装配期过滤：这里只认已经 `apply` 过的会话；没登记过的（没装模式那层的部署）一律放行。
    ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
      const agent = context.agent;
      const applied = agent === undefined ? undefined : this.applied.get(agent);
      if (applied === undefined) return next();
      if (applied.gate === undefined && applied.runtimeContext) return next();
      const gate = applied.gate;
      const result = await next();
      return {
        ...result,
        // 工具自己的说明 section 与工具目录同源：目录里没有的工具，它的说明也不该留在提示词里。
        sections: result.sections.filter((section) => {
          // 动态快照关掉时，harness 的平台说明（实现检出路径与 Web GUI 朝向）也不该留在提示词里。
          if (!applied.runtimeContext && RUNTIME_SECTIONS.has(section.name)) return false;
          if (gate === undefined) return true;
          if (gate !== undefined && section.name.startsWith(TOOL_SECTION_PREFIX)) {
            return denialOf(gate, section.name.slice(TOOL_SECTION_PREFIX.length)) === undefined;
          }
          // MCP server 的指令是一条 `mcp:<server>` section：整组工具都不可见时，它也不该留在提示词里。
          if (gate !== undefined && section.name.startsWith("mcp:")) {
            const server = section.name.slice("mcp:".length);
            return applied.known.some(
              (name) => name.startsWith(`mcp__${server}__`) && denialOf(gate, name) === undefined,
            );
          }
          return true;
        }),
      };
    });
  }

  // 把某个会话收口到这份定义上（同一个 agent 再调就是换一份）。
  apply(agent: Agent, definition: SessionScopeDefinition): void {
    const previous = this.applied.get(agent);
    if (previous !== undefined) previous.dispose();
    // 两份名单都空 = 不过滤：没有守卫要装，装配期也一路放行。
    const gate = gateOfNames(definition.allowTools, definition.denyTools);
    const skillGate = gateOfNames(definition.allowSkills, definition.denySkills);

    // 落在 `agent.ctx` 上的那几件用一个 effect 装：注入面的抑制与动态快照抑制是 scope 层的注册；执行层 guard
    // 要等 `tools` 激活才装得上（`inject` 的回调），它挂在那个 inject fiber 下，所以收回时连 fiber 一起收。
    const dispose = agent.ctx.effect(() => {
      const stoppers: (() => void)[] = [];
      // 三个抑制面：官方 `agent-instructions`（工作区指令）、官方 `skill-catalog`（技能目录）与官方 `time-context`
      // （时钟）都在装配投影之外自己往这条瀑布里 append，所以只能在这里丢它们的条目（技能目录那条还要按名收窄）。
      //
      // 两件事让这条注册必须落在**会话**上而不是行上：
      // - `prepend` 只是把自己排到表头，不保证一直在那儿：表头归**最后**注册的那个 prepend，而时钟那条也 prepend；
      // - 官方那几行随 preset 挂载（早于 `agent/created`，本注册就在那儿），所以按会话注册天然排在它们之后。
      //   换模式 / 换 preset 时 `apply` 会重来一遍（旧的收回、新的 prepend），最外层由此回到我们手上。
      stoppers.push(
        agent.ctx.on(
          "agent/pre-step",
          async (_payload, next): Promise<PreStepDecision> => {
            const decision = await next();
            if (decision.kind !== "enter") return decision;
            const kept = this.suppress(decision.messages, definition, skillGate);
            return kept === undefined ? decision : { ...decision, messages: kept };
          },
          { prepend: true },
        ),
      );
      if (definition.runtimeContext === false) {
        // service 在 `agent.ctx` 上是 shadow：抑制落在该 agent 的 scope 层，只覆盖这个会话。
        stoppers.push(agent.ctx.systemPrompt.suppressRuntimeContext());
      }
      // 工具面必须落在 `agent.ctx` 上才是这个会话的作用域。`tools` 服务通常已激活（agent 建好就有），
      // 那时**同步**注册：装配瀑布读的目录必须立刻是收窄后的那一份；没激活才退回 `inject`（它的回调晚一步，
      // 由下一次装配兜住）。注册返回的 disposer 自己收——`restrict` / `guard` 的 effect 归 tools 服务的 ctx，
      // 不随本 effect 收回。
      const install = (scope: Context): (() => void)[] => {
        const disposers: (() => void)[] = [];
        // 工具面：收窄**注册表视图**（目录与执行同一份）。名单里没注册的名字先滤掉——`restrict` 对未知的
        // 全局工具名直接抛，而"行清单里缺工具的 preset"是合法部署形态；白名单过滤后可能为空数组，那正是
        // "一件都收不到"的语义（与省略 `allow` 的"全部放行"区分开）。
        const definitions = scope.tools.definitions(agent);
        const known = definitions.map((tool) => tool.name);
        this.catalogs.set(
          agent,
          definitions.map((tool) => ({ name: tool.name, description: tool.description })),
        );
        // 按需组默认不可见：模式不设白名单时，模型先用 `tool_group_list` 看组、再用 `tool_group_load`
        // 放行一组。常驻组（`isResidentToolGroup`）不在 `groups` 里，它们一直留在目录。放行是会话内的，
        // 重建 `restrict` 即生效，工具增减由 loop 记成 `developer` 消息（`toolUpdate` 路由上随历史追加）。
        // 设了白名单的模式不做按需——那些模式的意图本来就是"只留这几件"。
        const groups =
          gate === undefined || gate.allow === undefined
            ? groupTools(known)
            : new Map<string, string[]>();
        const activated = this.activatedGroups.get(agent) ?? new Set<string>();
        this.activatedGroups.set(agent, activated);
        const face: ToolFace = {
          agent,
          known,
          baseDeny: new Set(definition.denyTools),
          allowOverride: new Set(definition.allowToolsOverride ?? []),
          denyOverride: new Set(definition.denyToolsOverride ?? []),
          groups,
        };
        this.faces.set(agent, face);
        if (groups.size > 0) {
          disposers.push(scope.tools.register(this.groupListTool(groups)));
          disposers.push(scope.tools.register(this.groupLoadTool(scope, gate, face, activated)));
        }
        this.restrict(scope, gate, face, activated);
        if (skillGate !== undefined) {
          disposers.push(
            scope.tools.guard((exec) => {
              // 技能面：`skill` 工具本身照旧可用，被收窄的是它这次要加载的那一件技能。
              if (exec.name !== SKILL_TOOL_NAME) return undefined;
              const skillName = skillNameOf(exec.arguments);
              if (skillName === undefined) return undefined;
              const skillDenial = denialOf(skillGate, skillName);
              return skillDenial === undefined
                ? undefined
                : skillRefusalOf(skillName, definition.name, skillDenial);
            }),
          );
        }
        return [
          ...disposers,
          () => {
            face.disposeRestriction?.();
            face.disposeRestriction = undefined;
          },
        ];
      };
      if (agent.ctx.get("tools") === undefined) {
        const fiber = agent.ctx.inject(["tools"], (scope) => {
          stoppers.push(...install(scope));
        });
        stoppers.push(() => fiber.dispose());
      } else {
        stoppers.push(...install(agent.ctx));
      }
      return stoppers;
    }, "session-mode: per-session gate");

    // 通道那一侧的降级注入按 agent 覆盖，不需要收回。
    this.channel()?.setInstructions(agent, definition.instructions);

    // 组引用要用工具名全集展开后才是装配期过滤能认的名字；known 由 install 抓到（`faces`）。
    const known = this.faces.get(agent)?.known ?? [];
    const expand = (names: readonly string[]): string[] => {
      const out = new Set<string>();
      for (const ref of names) {
        if (ref.startsWith("group:") || ref.startsWith("mcp:")) {
          const group = refGroup(ref);
          for (const tool of known) if (toolGroupOf(tool) === group) out.add(tool);
        } else {
          out.add(ref);
        }
      }
      return [...out];
    };
    const expandedDeny = expand(definition.denyTools);
    for (const id of definition.allowToolsOverride ?? []) {
      const at = expandedDeny.indexOf(id);
      if (at >= 0) expandedDeny.splice(at, 1);
    }
    for (const id of definition.denyToolsOverride ?? []) {
      if (!expandedDeny.includes(id)) expandedDeny.push(id);
    }
    const allowExpanded = expand(definition.allowTools);
    this.applied.set(agent, {
      // 按需面里还没放行的工具也要进 deny：否则它们的 `tool:` 说明会留在提示词里，而目录里没有它们。
      gate: gateOfNames(allowExpanded, [...expandedDeny, ...this.onDemandDeny(agent)]),
      allowExpanded,
      denyExpanded: expandedDeny,
      known,
      runtimeContext: definition.runtimeContext,
      dispose,
    });
  }

  // 按需面里还没放行的工具名：它们既不进目录，说明 section 也不该留。
  private onDemandDeny(agent: Agent): string[] {
    const face = this.faces.get(agent);
    if (face === undefined) return [];
    const activated = this.activatedGroups.get(agent);
    const denied: string[] = [];
    for (const [group, tools] of face.groups) {
      if (activated?.has(group) === true) continue;
      denied.push(...tools);
    }
    return denied;
  }

  // 全量工具目录（id + 描述）：面板的"工具"折叠组读它。
  catalogOf(agent: Agent): readonly { name: string; description: string }[] {
    return this.catalogs.get(agent) ?? [];
  }

  // 按当前已放行的组重算工具面：模式白名单与基础黑名单原样，未放行那一组的工具进 deny。
  private restrict(
    scope: Context,
    gate: NameGate | undefined,
    face: ToolFace,
    activated: ReadonlySet<string>,
  ): void {
    face.disposeRestriction?.();
    face.disposeRestriction = undefined;
    // 名单里可以引用整组（`mcp:<server>` / `group:<id>`）：先展开成组内工具，再按组放行。
    const denied = new Set<string>();
    for (const ref of face.baseDeny) {
      if (ref.startsWith("group:") || ref.startsWith("mcp:")) {
        const group = refGroup(ref);
        for (const tool of face.known) if (toolGroupOf(tool) === group) denied.add(tool);
      } else {
        denied.add(ref);
      }
    }
    for (const [group, tools] of face.groups) {
      if (activated.has(group)) continue;
      for (const tool of tools) denied.add(tool);
    }
    // 逐条目三态在组引用展开之后应用：显式允许把名字从 deny 里拿掉，显式禁止加进去。
    for (const id of face.allowOverride) denied.delete(id);
    for (const id of face.denyOverride) denied.add(id);
    if (gate?.allow === undefined && denied.size === 0) return;
    const known = new Set(face.known);
    face.disposeRestriction = scope.tools.restrict({
      ...(gate?.allow === undefined
        ? {}
        : { allow: [...gate.allow].filter((name) => known.has(name)) }),
      ...(denied.size === 0 ? {} : { deny: [...denied].filter((name) => known.has(name)) }),
    });
  }

  // 常驻的组目录：只列组名、数量与前三个工具名。被收窄的工具定义读不到，所以这里不猜描述。
  private groupListTool(groups: ReadonlyMap<string, readonly string[]>): ToolDefinition {
    return defineTool({
      name: "tool_group_list",
      description:
        "List on-demand tool groups. Tools in these groups stay out of the catalog until you load their group with tool_group_load.",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            groups: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string", required: true },
                  count: { type: "number", required: true },
                  examples: { type: "array", required: true, items: { type: "string" } },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      async execute() {
        return {
          groups: [...groups].map(([name, tools]) => ({
            name,
            count: tools.length,
            examples: tools.slice(0, 3),
          })),
        };
      },
    });
  }

  // 放行一组：接受 `mcp:<server>` / `group:<id>`，也可以只写后半截。工具在下一步出现在目录里。
  private groupLoadTool(
    scope: Context,
    gate: NameGate | undefined,
    face: ToolFace,
    activated: Set<string>,
  ): ToolDefinition {
    return defineTool({
      name: "tool_group_load",
      description:
        'Load one on-demand tool group so its tools appear in the catalog from the next step. Pass a group name from tool_group_list, such as "mcp:agent-browser" or "group:web".',
      parameters: {
        group: {
          type: "string",
          required: true,
          description:
            'Group name from tool_group_list, e.g. "mcp:agent-browser" or "group:web" (the "mcp:" / "group:" prefix may be omitted).',
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            group: { type: "string", required: true },
            count: { type: "number", required: true },
            error: { type: "string" },
          },
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      execute: async (args) => {
        const matched = matchGroup(face.groups, args.group);
        if (matched === undefined) {
          return {
            group: args.group,
            count: 0,
            error: "unknown tool group; call tool_group_list first",
          };
        }
        activated.add(matched.name);
        this.restrict(scope, gate, face, activated);
        // 装配期名单跟着重算：放行之后它们的 `tool:` 说明该回到提示词里（与目录同源）。
        const applied = this.applied.get(face.agent);
        if (applied !== undefined) {
          applied.gate = gateOfNames(applied.allowExpanded, [
            ...applied.denyExpanded,
            ...this.onDemandDeny(face.agent),
          ]);
        }
        return { group: matched.name, count: matched.tools.length };
      },
    });
  }

  // 三个抑制面按这份定义过一遍本步的消息表：`undefined` = 一条都不动（开关都是"要"、技能名单也没排除谁），
  // 其余 = 过滤 / 按名收窄之后的那份表。
  private suppress(
    messages: readonly UserMessage[],
    definition: SessionScopeDefinition,
    skillGate: NameGate | undefined,
  ): UserMessage[] | undefined {
    let changed = false;
    const kept: UserMessage[] = [];
    for (const message of messages) {
      const kind = kindOf(message);
      if (kind === "agent-instructions") {
        if (definition.instructions) kept.push(message);
        else changed = true;
        continue;
      }
      if (kind === "skill-catalog") {
        if (!definition.skills) {
          changed = true;
          continue;
        }
        const narrowed =
          skillGate === undefined
            ? undefined
            : narrowCatalog(message, skillGate, (line) =>
                this.ctx.logger.warn(`session-mode: ${line}`),
              );
        if (narrowed === undefined) kept.push(message);
        else {
          changed = true;
          kept.push(narrowed);
        }
        continue;
      }
      if (kind === "time-context") {
        // 时钟也归"动态快照"：它不经 `suppressRuntimeContext`（那是 snapshot section 那条路），只在瀑布上丢。
        if (definition.runtimeContext) kept.push(message);
        else changed = true;
        continue;
      }
      kept.push(message);
    }
    return changed ? kept : undefined;
  }

  // 通道是可选的搭档：没有它就没有降级注入可关，工具面与三个抑制面照常生效。
  private channel(): { setInstructions(agent: Agent, on: boolean): void } | undefined {
    try {
      return this.ctx.get("contextAssembler");
    } catch {
      return undefined;
    }
  }
}
