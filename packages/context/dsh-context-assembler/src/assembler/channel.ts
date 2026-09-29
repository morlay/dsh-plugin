import type { Agent } from "@deepseek-ai/dsh-agent";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { MessageSource } from "@deepseek-ai/dsh-llm";
import { renderReminder, renderVirtualSkill } from "./reminder.ts";

// 正文到达模型的方式：自动注入，或等模型按需加载。
export type InjectionMode = "auto" | "on-demand";

// 一条按 skill 形态声明的注入：正文是本仓库维护的文案，与 agent 无关（工具集在装配期就定了），所以 skill
// 在装配期注册一次、全局可见。
export interface PromptSkillDeclaration {
  // kebab-case：skill 名，也是注入条目的 id。
  readonly name: string;
  readonly title: string;
  // 目录行摘要：讲清什么时候该加载它。
  readonly description: string;
  // 正文按**会话**生成：模式可能只给一部分工具，正文要跟着修剪（不该讲用不到的工具）。
  // 不传 agent（装配期注册 skill 时）返回不过滤的完整版。
  readonly content: (agent?: Agent) => string;
  // 这个 skill 赖以成立的**入口工具**（任一存在即可，不是全部）：都不可见时它不出现在该会话的技能目录里。
  // 声明方自己挑入口，别把组内所有可能的工具都倒进来（子代理控制行与团队插件会提供同名工具）。
  readonly requires?: readonly string[];
  // 缺省 `on-demand`：只有正文确有必要常驻时才写 `auto`。
  readonly injection?: InjectionMode;
}

interface RegisteredSkill {
  readonly digest: string;
  readonly dispose: () => void;
}

interface AgentState {
  // 本步装配降级出来的 section 条目：id → 正文（未渲染信封）。
  sections: ReadonlyMap<string, string>;
}

// 一条规则块声明：系统级信息（工作区指令、skill 目录），文本按 id 幂等注入、同 id 覆盖。
// 文本可以是异步的（skill 目录要读 skill 注册表）。
export interface PromptRuleDeclaration {
  readonly id: string;
  readonly text: (agent: Agent) => string | Promise<string>;
  // 这条规则的对外身份：工作区指令那一面按上游 kind 发消息（skill 面相反，用我们自己的 kind），让按 kind 认领
  // 的消费方（客户端标签、上游的实验性约束收集）认得出来；不声明就是通道自己的 `context-assembler`。幂等键仍是 `id`。
  readonly source?: (agent: Agent) => MessageSource;
}

// 一条待注入的条目：正文已渲染好，`source` 是它声明给外部的身份。
export interface PromptEntry {
  readonly text: string;
  readonly source?: MessageSource;
}

// 注入通道：调用方声明「什么内容、怎么到达模型」，这里负责到达方式。
//
// - `on-demand`：注册成模型可用 skill（进 skill 目录，正文按需加载）；
// - `auto`：正文自动注入 reminder（注册成 skill 但标 `modelInvocable: false`）；
// - `replaceSection` / `suppressSection`：装配结果上的文本改写与丢弃。
//
// 覆盖语义（同 id 最新取代更早）由系统提示词里的声明说明一次，见 [`rules.ts`](./rules.ts)。
export class ContextAssembler extends Service {
  private readonly declarations = new Map<string, PromptSkillDeclaration>();
  private readonly rules = new Map<string, PromptRuleDeclaration>();
  private readonly overrides = new Map<string, (agent: Agent) => string | undefined>();
  private readonly suppressed = new Set<string>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly states = new WeakMap<Agent, AgentState>();
  // 不要 instruction 类注入的会话（模式说了 `instructions: false`）：常驻正文、规则块与降级 section 都不进。
  // 按需 skill 不受它管（那是模型自己加载），引用材料也不经通道。
  private readonly withoutInstructions = new WeakSet<Agent>();

  // 本会话的模式收窄（白名单）：投影层的过滤不碰注册表，注册表上看不出"谁能用"。
  private readonly toolScopes = new WeakMap<Agent, (tool: string) => boolean>();

  // `host` 是构造期那个根 ctx：`skills` 的访问权限挂在插件的 inject 声明上，不能依赖访问者 ctx。
  constructor(private readonly host: Context) {
    super(host, "contextAssembler");
  }

  registerSkill(declaration: PromptSkillDeclaration): () => void {
    this.declarations.set(declaration.name, declaration);
    this.refreshSkills();
    return () => {
      if (this.declarations.get(declaration.name) !== declaration) return;
      this.declarations.delete(declaration.name);
      this.refreshSkills();
    };
  }

  registerRule(declaration: PromptRuleDeclaration): () => void {
    this.rules.set(declaration.id, declaration);
    return () => {
      if (this.rules.get(declaration.id) === declaration) this.rules.delete(declaration.id);
    };
  }

  replaceSection(name: string, text: (agent: Agent) => string | undefined): () => void {
    this.overrides.set(name, text);
    return () => {
      if (this.overrides.get(name) === text) this.overrides.delete(name);
    };
  }

  suppressSection(name: string): () => void {
    this.suppressed.add(name);
    return () => {
      this.suppressed.delete(name);
    };
  }

  isSuppressed(name: string): boolean {
    return this.suppressed.has(name);
  }

  // 装配结果上该 section 要换成的文本；undefined 表示原样保留。
  replacement(name: string, agent: Agent | undefined): string | undefined {
    const override = this.overrides.get(name);
    return override === undefined || agent === undefined ? undefined : override(agent);
  }

  // 这个会话要不要 instruction 类注入（模式说了 `instructions: false` 就是不要，见 `withoutInstructions`）。
  setInstructions(agent: Agent, on: boolean): void {
    if (on) this.withoutInstructions.delete(agent);
    else this.withoutInstructions.add(agent);
  }

  // 本会话的**工具收窄**（模式白名单）：投影层只过滤装配结果、不碰工具注册表，所以"谁能用"要在通道上登记，
  // 技能目录与组正文才收得住（谓词由 `context-scope` 那一行给，通道自己不碰 `tools` 服务）。
  restrictTools(agent: Agent, allowed: (tool: string) => boolean): void {
    this.toolScopes.set(agent, allowed);
  }

  // 本会话的工具可见性：调用方给出的注册表可见性 × 已登记的模式收窄。技能目录与组正文共用它，
  // 免得同一套判据在几处各写一遍。
  visibleTools(agent: Agent, registered: (tool: string) => boolean): (tool: string) => boolean {
    const allowed = this.toolScopes.get(agent);
    return allowed === undefined ? registered : (tool) => registered(tool) && allowed(tool);
  }

  // 该会话看不到的 skill 名：声明了 `requires` 而依赖的工具一个都不可见。目录由 `context-skill-catalog` 渲染，
  // 它把工具可见性作为谓词传进来（通道不碰 `tools` 服务）。
  hiddenSkills(visible: (tool: string) => boolean): ReadonlySet<string> {
    const hidden = new Set<string>();
    for (const [name, declaration] of this.declarations) {
      const requires = declaration.requires;
      if (requires === undefined || requires.length === 0) continue;
      if (!requires.some(visible)) hidden.add(name);
    }
    return hidden;
  }

  // 该 skill 按会话修剪后的正文：注册表只能存一份（技能注册是装配期一次、全局可见），所以按需加载
  // 路径（接管的 `skill` 工具）要用这里重新算一次，才和 `auto` 正文一样跟着工具走。
  contentFor(name: string, agent: Agent | undefined): string | undefined {
    return this.declarations.get(name)?.content(agent);
  }

  // 一个 skill 在这个会话能不能被用到：声明了 `requires` 时至少一个工具在模式收窄内。
  private reachable(
    declaration: PromptSkillDeclaration,
    scope: ((tool: string) => boolean) | undefined,
  ): boolean {
    const requires = declaration.requires;
    if (requires === undefined || requires.length === 0) return true;
    // 没有收窄（没装模式的部署）就是全可见。
    if (scope === undefined) return true;
    return requires.some((tool) => scope(tool));
  }

  // 本步要注入的条目：键 → 已渲染好的正文（规则块或内容块）。
  // `sections` 来自本步装配，`rules` 与 `auto` skill 正文在这里现算。
  async collect(agent: Agent): Promise<Map<string, PromptEntry>> {
    const entries = new Map<string, PromptEntry>();
    const scope = this.toolScopes.get(agent);
    // 这一档开关管**一切 instruction 类送达**：常驻正文（内容块）、规则块、降级 section。按需 skill 照常注册
    // （模型自己调 `skill` 才拿到正文）；用户手打 `@` 引用带进来的材料走 `@morlay/dsh-reference`，不经这里。
    const instructionsOff = this.withoutInstructions.has(agent);
    if (!instructionsOff) {
      for (const declaration of this.declarations.values()) {
        if ((declaration.injection ?? "on-demand") !== "auto") continue;
        // 常驻正文也跟随工具可见性：它声明的 `requires` 工具在这个会话一个都不可用，正文就不该注入
        // （与 skill 目录那侧的 `hiddenSkills` 同一判据；通道不碰 tools 注册表，只用模式收窄那一份）。
        if (!this.reachable(declaration, scope)) continue;
        const body = declaration.content(agent);
        // 常驻送达的 skill 正文与按需加载同一形态：内容块，不是规则块。
        if (body.length > 0)
          entries.set(declaration.name, { text: renderVirtualSkill(declaration.name, body) });
      }
    }
    for (const declaration of this.rules.values()) {
      if (instructionsOff) break;
      // 注入路径不能被任何一个内容提供者拖死：文本是异步算的（技能目录要读注册表、工作区指令要读文件），
      // 谁卡住都不该让人等在这里——超时或抛错都按"这条没有内容"处理。
      const text = await withTimeout(declaration.text(agent), CONTENT_TIMEOUT_MS);
      if (text.length > 0) {
        entries.set(declaration.id, {
          text: renderReminder(declaration.id, text),
          ...(declaration.source === undefined ? {} : { source: declaration.source(agent) }),
        });
      }
    }
    if (!instructionsOff) {
      for (const [id, text] of this.sectionsOf(agent)) {
        entries.set(id, { text: renderReminder(id, text) });
      }
    }
    return entries;
  }

  private sectionsOf(agent: Agent): ReadonlyMap<string, string> {
    return this.states.get(agent)?.sections ?? new Map();
  }

  // 每步装配调一次：记下本步降级出来的 section 文本，供下一步注入。
  sync(agent: Agent, input: { readonly sections: ReadonlyMap<string, string> }): void {
    this.stateOf(agent).sections = input.sections;
  }

  // skill 注册（装配期一次，全局可见）：正文没变的不重注册。
  private refreshSkills(agent?: Agent): void {
    for (const [name, declaration] of this.declarations) {
      const content = declaration.content(agent);
      const modelInvocable = (declaration.injection ?? "on-demand") === "on-demand";
      const digest = `${modelInvocable ? "model" : "auto"}\u0000${declaration.description}\u0000${content}`;
      const current = this.skills.get(name);
      if (current?.digest === digest) continue;
      current?.dispose();
      const dispose = this.host.skills.register({
        name,
        description: declaration.description,
        content,
        source: "runtime",
        invocation: { modelInvocable, userInvocable: true },
      });
      this.skills.set(name, { digest, dispose });
    }
    for (const [name, registered] of this.skills) {
      if (this.declarations.has(name)) continue;
      registered.dispose();
      this.skills.delete(name);
    }
  }

  private stateOf(agent: Agent): AgentState {
    const existing = this.states.get(agent);
    if (existing !== undefined) return existing;
    const state: AgentState = { sections: new Map() };
    this.states.set(agent, state);
    return state;
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    contextAssembler: ContextAssembler;
  }
}

// 一条注入内容的取用上限：超过就按"没有内容"处理，不阻塞这一轮请求。
const CONTENT_TIMEOUT_MS = 2000;

async function withTimeout(work: string | Promise<string>, ms: number): Promise<string> {
  if (typeof work === "string") return work;
  const settled = Promise.resolve(work).catch(() => "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      resolve("");
    }, ms);
  });
  try {
    return await Promise.race([settled, expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
