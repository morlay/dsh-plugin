import type { Agent } from "@deepseek-ai/dsh-agent";
import { Service, type Context } from "@deepseek-ai/cordis";
import { renderReminder, renderVirtualSkill } from "./reminder.ts";

/** 正文到达模型的方式：自动注入，或等模型按需加载。 */
export type InjectionMode = "auto" | "on-demand";

/**
 * 一条按 skill 形态声明的注入：正文是本仓库维护的文案。
 *
 * 正文与 agent 无关（工具集在装配期就定了），所以 skill 在装配期注册一次、全局可见。
 */
export interface PromptSkillDeclaration {
  /** kebab-case：skill 名，也是注入条目的 id。 */
  readonly name: string;
  readonly title: string;
  /** 目录行摘要：讲清什么时候该加载它。 */
  readonly description: string;
  /**
   * 正文按**会话**生成：模式可能只给一部分工具，正文要跟着修剪（不该讲用不到的工具）。
   * 不传 agent（装配期注册 skill 时）返回不过滤的完整版。
   */
  readonly content: (agent?: Agent) => string;
  /** 缺省 `on-demand`：只有正文确有必要常驻时才写 `auto`。 */
  readonly injection?: InjectionMode;
}

interface RegisteredSkill {
  readonly digest: string;
  readonly dispose: () => void;
}

interface AgentState {
  /** 本步装配降级出来的 section 条目：id → 正文（未渲染信封）。 */
  sections: ReadonlyMap<string, string>;
}

/**
 * 一条规则块声明：系统级信息（工作区指令、skill 目录），文本按 id 幂等注入、同 id 覆盖。
 * 文本可以是异步的（skill 目录要读 skill 注册表）。
 */
export interface PromptRuleDeclaration {
  readonly id: string;
  readonly text: (agent: Agent) => string | Promise<string>;
}

/**
 * 注入通道：调用方声明「什么内容、怎么到达模型」，这里负责到达方式。
 *
 * - `on-demand`：注册成模型可用 skill（进 skill 目录，正文按需加载）；
 * - `auto`：正文自动注入 reminder（注册成 skill 但标 `modelInvocable: false`，因为已经常驻）；
 * - `replaceSection` / `suppressSection`：装配结果上的文本改写与丢弃。
 *
 * 覆盖语义（同 id 最新取代更早）由系统提示词里的声明说明一次，见 [`rules.ts`](./rules.ts)。
 */
export class ContextAssembler extends Service {
  private readonly declarations = new Map<string, PromptSkillDeclaration>();
  private readonly rules = new Map<string, PromptRuleDeclaration>();
  private readonly overrides = new Map<string, (agent: Agent) => string | undefined>();
  private readonly suppressed = new Set<string>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly states = new WeakMap<Agent, AgentState>();
  /** 不要 instruction 类注入（规则块）的会话；内容块（技能正文、引用材料）不受它管。 */
  private readonly withoutInstructions = new WeakSet<Agent>();

  /** `host` 是构造期那个根 ctx：`skills` 的访问权限挂在插件的 inject 声明上，不能依赖访问者 ctx。 */
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

  /** 装配结果上该 section 要换成的文本；undefined 表示原样保留。 */
  replacement(name: string, agent: Agent | undefined): string | undefined {
    const override = this.overrides.get(name);
    return override === undefined || agent === undefined ? undefined : override(agent);
  }

  /**
   * 本步要注入的条目：键 → 已渲染好的正文（规则块或内容块）。
   * `sections` 来自本步装配，`rules` 与 `auto` skill 正文在这里现算。
   */
  /** 这个会话不要 instruction 类的规则块（模式说了 `instructions: false`）。 */
  setInstructions(agent: Agent, on: boolean): void {
    if (on) this.withoutInstructions.delete(agent);
    else this.withoutInstructions.add(agent);
  }

  async collect(agent: Agent): Promise<Map<string, string>> {
    const entries = new Map<string, string>();
    for (const declaration of this.declarations.values()) {
      if ((declaration.injection ?? "on-demand") !== "auto") continue;
      const body = declaration.content(agent);
      // 常驻送达的 skill 正文与按需加载同一形态：内容块，不是规则块。
      if (body.length > 0)
        entries.set(declaration.name, renderVirtualSkill(declaration.name, body));
    }
    const instructionsOff = this.withoutInstructions.has(agent);
    for (const declaration of this.rules.values()) {
      if (instructionsOff) break;
      // 注入路径不能被任何一个内容提供者拖死：文本是异步算的（技能目录要读注册表、工作区指令要读文件），
      // 谁卡住都不该让人等在这里——超时或抛错都按"这条没有内容"处理。
      const text = await withTimeout(declaration.text(agent), CONTENT_TIMEOUT_MS);
      if (text.length > 0) entries.set(declaration.id, renderReminder(declaration.id, text));
    }
    if (!instructionsOff) {
      for (const [id, text] of this.sectionsOf(agent)) {
        entries.set(id, renderReminder(id, text));
      }
    }
    return entries;
  }

  private sectionsOf(agent: Agent): ReadonlyMap<string, string> {
    return this.states.get(agent)?.sections ?? new Map();
  }

  /**
   * 每步装配调一次：记下回收到的文本（正文随之更新），并算出本步要注入的条目。
   */
  sync(agent: Agent, input: { readonly sections: ReadonlyMap<string, string> }): void {
    this.stateOf(agent).sections = input.sections;
  }

  /** skill 注册（装配期一次，全局可见）：正文没变的不重注册。 */
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

/** 一条注入内容的取用上限：超过就按"没有内容"处理，不阻塞这一轮请求。 */
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
