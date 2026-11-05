// 按**会话**收口：一份模式定义落成这个会话的工具面与几个抑制面。
//
// `apply` 落到这个 agent 身上四件事：工具面（`agent.ctx.tools.restrict`）、`tool:<工具名>` 说明 section、
// 执行层 guard（技能面），以及官方几条注入面（行级的 `agent/pre-step` 上按 agent 查表丢）。
// PTC 出现时（装配里有 PTC 执行器的专属 section）再把 `tools:sdk` 换成稳定骨架——判据是运行时事实。
import type { Agent } from "@morlay/dsh-agent/contract";
import { ToolRegistry } from "@morlay/dsh-agent";
import type { MessageSource, UserMessage } from "@morlay/dsh-agent/contract";
import { Skill } from "@morlay/dsh-skill";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { ContextAssembler } from "./contract/context-assembler.contract.ts";
import {
  SessionScope,
  type ScopedToolEntry,
  type SessionScopeAccount,
  type SessionScopeDefinition,
} from "./contract/session-scope.contract.ts";
import {
  AgentPreStep,
  SystemPromptAssemble,
  type PreStepDecision,
  sourceKindOf,
} from "./events.ts";
import { groupDescriptorOf } from "./guidance/groups.ts";
import {
  PTC_ONLY_SECTION,
  groupTools,
  isProtectedTool,
  refGroup,
  toolGroupOf,
} from "./guidance/tool-groups.ts";
import { perAgentAccount } from "./per-agent.ts";
import { projectToolSchema } from "@morlay/dsh-agent/contract";
import { describeToolDefinition, type DescribeEntry } from "./ptc-describe.ts";
import { ptcSections } from "./ptc-sdk.ts";

// 单个工具的说明 section 名前缀：`tool:<工具名>`（`tools:` 那类是聚合块，不归收口管）。
const TOOL_SECTION_PREFIX = "tool:";

// 归"动态快照"的两条平台说明 section（实现检出路径、Web GUI 朝向）。
const RUNTIME_SECTIONS: ReadonlySet<string> = new Set(["harness:source", "app:web-surface"]);

// 加载技能的那个官方工具名。
const SKILL_TOOL_NAME = "skill";

type Denial = "not-allowlisted" | "denylisted";

const SKILL_REFUSAL = (skill: string, mode: string, denial: Denial): string =>
  denial === "denylisted"
    ? `${skill} 被「${mode}」的技能黑名单排除，加载它不会有结果；按当前模式可用的技能完成任务，或让用户切到别的模式。`
    : `${skill} 不在「${mode}」的技能白名单里，加载它不会有结果；按当前模式可用的技能完成任务，或让用户切到别的模式。`;

// 一份**合成**出来的名单面：最终可用 = (白名单留空 ? 全部 : 白名单) − 黑名单。
interface NameGate {
  readonly allow: ReadonlySet<string> | undefined;
  readonly deny: ReadonlySet<string>;
}

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

// 技能目录正文里的条目行：`- \`<技能名>\`: <说明>`（官方 `tool-skill` 的渲染形状）。
const CATALOG_LINE = /^- `([^`]+)`: /u;

// 按技能名单收窄一条 `skill-catalog` 正文：删掉被拒技能那几行，`source.entries` 不动
// （官方按那份结构化名单的 digest 判目录要不要重发，改了它会每一步都重发一条目录）。
function narrowCatalog(
  message: UserMessage,
  gate: NameGate,
  warn: (line: string) => void,
): UserMessage | undefined {
  const source = message.source as {
    readonly entries?: readonly { readonly name: string }[];
  };
  const denied = new Set(
    (source.entries ?? [])
      .map((entry) => entry.name)
      .filter((name) => denialOf(gate, name) !== undefined),
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
  const missing = [...denied].filter((name) => !removed.has(name));
  if (missing.length > 0) {
    warn(`skill catalog lines not recognized; denied skills stay listed: ${missing.join(", ")}`);
    return undefined;
  }
  return { ...message, content: [{ ...block, text: lines.join("\n") }] };
}

// `skill` 工具调用的技能名：参数形状是官方那一行的 `{ name: string }`。
function skillNameOf(arguments_: unknown): string | undefined {
  if (typeof arguments_ !== "object" || arguments_ === null) return undefined;
  const name = (arguments_ as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

// 一个 agent 当前装着的那一份（行级订阅按它查表）。
interface Applied {
  readonly gate: NameGate | undefined;
  readonly skillGate: NameGate | undefined;
  readonly definition: SessionScopeDefinition;
  readonly known: readonly string[];
  readonly dispose: () => void;
}

interface ToolFace {
  readonly known: readonly string[];
  readonly baseDeny: ReadonlySet<string>;
  readonly groups: ReadonlyMap<string, readonly string[]>;
  disposeRestriction?: (() => void) | undefined;
}

@Injectable()
export class SessionScopeDefault extends SessionScope implements OnInit {
  readonly assemble$ = new SystemPromptAssemble();

  readonly preStep$ = new AgentPreStep();

  private readonly tools = inject(ToolRegistry);

  private readonly channel = inject(ContextAssembler);

  private readonly skill = inject.optional(Skill);

  private readonly applied = new WeakMap<Agent, Applied>();

  private readonly activatedGroups = new WeakMap<Agent, Set<string>>();

  private readonly faces = new WeakMap<Agent, ToolFace>();

  private readonly catalogs = new WeakMap<Agent, readonly ScopedToolEntry[]>();

  private row: Context | undefined;

  onInit(ctx: Context): void {
    this.row = ctx;
    // 装配期过滤：只认已经 `apply` 过的会话（没装模式那层的部署一律放行）。
    this.assemble$.onWaterfall(async (assembly, context, next) => {
      const agent = context.agent as Agent | undefined;
      const applied = agent === undefined ? undefined : this.applied.get(agent);
      if (agent === undefined || applied === undefined) return next();
      // PTC 的判据是**运行时事实**：这一刻选中的执行器是 PTC 执行器。
      // 它的信号是它注册的专属 section（`tools:ptc-only`，只有它写这一条），模式配置说了不算。
      //
      // 为什么不用「可见工具里有 `run_code`」判：上游把 `run_code` 列为保留名（`tools` 的 `register` 与
      // `restrict` 都对它抛错），本包再把 `run_code` / `describe_tool` 列进 PROTECTED_TOOLS 从 deny 集里摘掉
      // ——它永远收不掉，两种判据不会分叉；而 section 是「执行器在场」的**唯一**可靠信号
      // （PTC 的 transport 是执行器私有实例，不进注册表）。
      // 骨架正文仍按可见工具现算（下一行的 `visibleTools`），所以正文跟着真实目录走。
      const ptc = assembly.sections.some((section) => section.name === PTC_ONLY_SECTION);
      const result = await next();
      const sections = result.sections.filter((section) => this.keepSection(section.name, applied));
      if (!ptc) return { ...result, sections };
      return { ...result, sections: [...ptcSections(sections, this.visibleTools(agent, context))] };
    });
  }

  account(agent: Agent): SessionScopeAccount {
    const row = this.row;
    if (row === undefined) throw new Error("session-mode: 收口在装配完成前被使用");
    return perAgentAccount(row, agent);
  }

  apply(agent: Agent, definition: SessionScopeDefinition): void {
    const previous = this.applied.get(agent);
    if (previous !== undefined) previous.dispose();
    const gate = gateOfNames(definition.allowTools, definition.denyTools);
    const skillGate = gateOfNames(definition.allowSkills, definition.denySkills);
    const scope = agent.ctx as unknown as Context;
    const account = this.account(agent);
    if (!definition.runtimeContext) {
      account.add(scope.systemPrompt.suppressRuntimeContext());
    }
    const definitions = this.tools.definitions(agent);
    const known = definitions.map((tool) => tool.name);
    this.catalogs.set(
      agent,
      definitions.map((tool) => ({ name: tool.name, description: tool.description ?? "" })),
    );
    // 按需组默认不可见：设了白名单的模式不做按需（那些模式的意图本来就是"只留这几件"）。
    const groups =
      gate === undefined || gate.allow === undefined
        ? groupTools(known)
        : new Map<string, string[]>();
    const activated = this.activatedGroups.get(agent) ?? new Set<string>();
    this.activatedGroups.set(agent, activated);
    const face: ToolFace = { known, baseDeny: new Set(definition.denyTools), groups };
    this.faces.set(agent, face);
    // 收窄句柄也记在这条账上：换模式 / 行重挂时旧的那份必须被抬起来，否则第二次 `apply` 读到的是
    // **已被上一次收窄过的** `definitions(agent)`，白名单里的名字会凭空消失（上一份 deny 永远留着）。
    account.add(() => {
      face.disposeRestriction?.();
      face.disposeRestriction = undefined;
    });
    // `describe_tool` 常驻：PTC 程序里随时取某一组的 d.ts。
    //
    // 注册无条件（不判 PTC 是否生效）：非 PTC 装配下模型看不到它（模型面由执行器的 `describe()` 决定），
    // 而白名单模式要能点名「允许」它——判据与源包一致。
    account.add(
      scope.tools.register(
        describeToolDefinition({
          entries: () => this.describeEntriesOf(agent),
          sectionOf: (name) => this.sectionTextOf(agent, name),
          groupOf: groupDescriptorOf,
        }) as never,
      ) as unknown as () => void,
    );
    this.restrict(scope, gate, face, activated);
    if (skillGate !== undefined) {
      account.add(
        scope.tools.guard((exec) => {
          if (exec.name !== SKILL_TOOL_NAME) return undefined;
          const skillName = skillNameOf(exec.arguments);
          if (skillName === undefined) return undefined;
          const skillDenial = denialOf(skillGate, skillName);
          return skillDenial === undefined
            ? undefined
            : SKILL_REFUSAL(skillName, definition.name, skillDenial);
        }) as unknown as () => void,
      );
    }
    this.channel.setInstructions(agent, definition.instructions);
    // 官方几条注入面（`agent-instructions` / `skill-catalog` / `time-context`）由各自的官方行在**装配投影之外**
    // 往瀑布里 append，只能在瀑布上丢。顺序是判据：那些行随 preset 挂在 `agent.ctx` 上、早于本注册，所以
    // 我们的过滤必须是**最外层**（`prepend`）才看得到它们 append 的那些消息。
    account.add(
      scope.on(
        "agent/pre-step",
        async (_payload: unknown, next: () => Promise<PreStepDecision>) => {
          const decision = await next();
          if (decision.kind !== "enter") return decision;
          const current = this.applied.get(agent);
          if (current === undefined) return decision;
          const kept = this.suppress(decision.messages, current);
          return kept === undefined ? decision : { ...decision, messages: kept };
        },
        { prepend: true },
      ) as unknown as () => void,
    );
    // 装配期过滤用的 gate 要**含按需组**：那些组的工具不进目录，它们的说明 section 也不该留在提示词里。
    // `restrict` 那一侧按同一份 `face.groups` 判，两处同源。
    this.applied.set(agent, {
      gate: this.gateWithOnDemand(gate, face, activated),
      skillGate,
      definition,
      known,
      dispose: () => account.release(),
    });
  }

  // 在名单之上再叠一层「按需组还没放行」：没放行的组里每一件工具都等价于进黑名单。
  private gateWithOnDemand(
    gate: NameGate | undefined,
    face: ToolFace,
    activated: ReadonlySet<string>,
  ): NameGate | undefined {
    const denied = new Set(gate?.deny ?? []);
    for (const [group, tools] of face.groups) {
      if (activated.has(group)) continue;
      for (const tool of tools) denied.add(tool);
    }
    if (gate?.allow === undefined && denied.size === 0) return undefined;
    return { allow: gate?.allow, deny: denied };
  }

  // `describe_tool` 要的那个快照：每条工具的 name / description / 参数与输出 schema。
  //
  // 读**收窄前**的全集（`definitions()`，不是 `definitions(agent)`）：按需组的工具默认不在目录里、
  // 被收口挡住，而 describe 正是模型发现它们的手段——判据与源包一致（收口是执行面，describe 是发现面）。
  // 每次调用现算（不缓存）：工具集随按需组与晚注册变化，缓存会把新组的签名漏掉。
  private describeEntriesOf(_agent: Agent): readonly DescribeEntry[] {
    return this.tools.definitions().map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      // `definition.parameters` 是 schemastery 形状；`projectToolSchema` 给出 JSON Schema，
      // 才能转成真实的 TS 参数类型（而不是 `JsonValue`）。
      parametersSchema: projectToolSchema(tool, false).parameters,
      outputSchema: tool.output?.schema,
    }));
  }

  // 某个工具的说明 section 正文（`tool:<name>`）：随 describe 一起返回，不占 system。
  private sectionTextOf(agent: Agent, name: string): string | undefined {
    const prompt = (
      agent.ctx as unknown as {
        systemPrompt?: { sections?: { get(key: string): { text?: unknown } | undefined } };
      }
    ).systemPrompt;
    const section = prompt?.sections?.get(`tool:${name}`);
    return typeof section?.text === "string" ? section.text : undefined;
  }

  knownTools(agent: Agent): readonly string[] {
    const applied = this.applied.get(agent);
    if (applied === undefined) return [];
    const names = this.tools.definitions(agent).map((tool) => tool.name);
    return applied.gate === undefined
      ? names
      : names.filter((tool) => denialOf(applied.gate as NameGate, tool) === undefined);
  }

  catalogOf(agent: Agent): readonly ScopedToolEntry[] {
    return this.catalogs.get(agent) ?? [];
  }

  async skillCatalog(agent: Agent): Promise<readonly ScopedToolEntry[]> {
    const skill = this.skill;
    if (skill === undefined) return [];
    const cwd = (agent.session.header as { cwd?: unknown } | undefined)?.cwd;
    const rows = await skill
      .list({ scope: agent, ...(typeof cwd === "string" ? { cwd } : {}) })
      .catch(() => [] as readonly { name: string; description: string }[]);
    return rows.map((row) => ({ name: row.name, description: row.description }));
  }

  // 这一次装配里模型面可见的工具名（装配瀑布拿到的 `toolSet` 就是这一步的准入集）。
  private visibleTools(agent: Agent, context: { readonly toolSet?: unknown }): string[] {
    try {
      const toolSet = context.toolSet as Parameters<ToolRegistry["schemas"]>[1];
      return this.tools.schemas(agent, toolSet).map((tool) => tool.name);
    } catch {
      // 没装执行器（极简装配）时读不到目录：按注册表可见名兜底。
      return this.tools.definitions(agent).map((tool) => tool.name);
    }
  }

  // 一条 section 要不要留在提示词里。
  private keepSection(name: string, applied: Applied): boolean {
    if (!applied.definition.runtimeContext && RUNTIME_SECTIONS.has(name)) return false;
    if (
      applied.definition.dropSections.some((pattern) =>
        pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
      )
    ) {
      return false;
    }
    const gate = applied.gate;
    if (gate === undefined) return true;
    // 工具自己的说明 section 与工具目录同源。
    if (name.startsWith(TOOL_SECTION_PREFIX)) {
      return denialOf(gate, name.slice(TOOL_SECTION_PREFIX.length)) === undefined;
    }
    // MCP server 的指令是一条 `mcp:<server>` section：整组工具都不可见时它也不该留着。
    if (name.startsWith("mcp:")) {
      const server = name.slice("mcp:".length);
      return applied.known.some(
        (tool) => tool.startsWith(`mcp__${server}__`) && denialOf(gate, tool) === undefined,
      );
    }
    return true;
  }

  // 按当前已放行的组重算工具面：模式白名单与基础黑名单原样，未放行那一组的工具进 deny。
  //
  // **必须经 agent 作用域的 tools 调**：上游 `restrict()` 读的是服务实例自己的 ctx（`scopeOf(this.ctx)`），
  // 行级的 tools 是全局作用域，调用会抛 `requires a scoped context` ——被下面的降级 catch 吞掉之后表现为
  // 「名单写了但工具面没变」。
  private restrict(
    scope: Context,
    gate: NameGate | undefined,
    face: ToolFace,
    activated: ReadonlySet<string>,
  ): void {
    face.disposeRestriction?.();
    face.disposeRestriction = undefined;
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
    for (const tool of denied) {
      if (isProtectedTool(tool)) denied.delete(tool);
    }
    if (gate?.allow === undefined && denied.size === 0) return;
    const known = new Set(face.known);
    const allow =
      gate?.allow === undefined
        ? undefined
        : [...gate.allow, ...[...known].filter((tool) => isProtectedTool(tool))].filter((tool) =>
            known.has(tool),
          );
    const denyList = [...denied].filter((tool) => known.has(tool));
    face.disposeRestriction = this.installRestriction(scope, allow, denyList);
  }

  // `tools.restrict` 只认**全局**工具名；名单里出现 agent 自己注册的名字时降级成"只按全局视图里有的名字"再试。
  private installRestriction(
    scope: Context,
    allow: readonly string[] | undefined,
    deny: readonly string[],
  ): (() => void) | undefined {
    const attempt = (
      nextAllow: readonly string[] | undefined,
      nextDeny: readonly string[],
    ): (() => void) | undefined => {
      if (nextAllow === undefined && nextDeny.length === 0) return undefined;
      try {
        return scope.tools.restrict({
          ...(nextAllow === undefined ? {} : { allow: [...nextAllow] }),
          ...(nextDeny.length === 0 ? {} : { deny: [...nextDeny] }),
        });
      } catch {
        // 收窄是增强，不该让整行装配失败；降级到下一档再试。
        return undefined;
      }
    };
    const first = attempt(allow, deny);
    if (first !== undefined || (allow === undefined && deny.length === 0)) return first;
    const global = new Set(this.tools.definitions().map((tool) => tool.name));
    return attempt(
      allow === undefined ? undefined : allow.filter((name) => global.has(name)),
      deny.filter((name) => global.has(name)),
    );
  }

  // 官方几条注入面按这份定义过一遍本步的消息表：`undefined` = 一条都不动。
  private suppress(messages: readonly UserMessage[], applied: Applied): UserMessage[] | undefined {
    let changed = false;
    const kept: UserMessage[] = [];
    for (const message of messages) {
      const kind = sourceKindOf(message.source as MessageSource);
      if (kind === "agent-instructions") {
        if (applied.definition.instructions) kept.push(message);
        else changed = true;
        continue;
      }
      if (kind === "skill-catalog") {
        if (!applied.definition.skills) {
          changed = true;
          continue;
        }
        const narrow =
          applied.skillGate === undefined
            ? undefined
            : narrowCatalog(message, applied.skillGate, (line) =>
                this.row?.logger.warn(`session-mode: ${line}`),
              );
        if (narrow === undefined) kept.push(message);
        else {
          changed = true;
          kept.push(narrow);
        }
        continue;
      }
      if (kind === "time-context") {
        if (applied.definition.runtimeContext) kept.push(message);
        else changed = true;
        continue;
      }
      kept.push(message);
    }
    return changed ? kept : undefined;
  }
}
