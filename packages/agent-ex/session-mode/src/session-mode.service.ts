// 会话模式的默认实现：模式清单（config 的纯数据 + `{dshHome}/modes/*.toml` 覆盖）、按会话的选择、
// 把一份模式定义落到该会话上（persona + 收口 + 默认模型兜底）。
import type { Agent } from "@morlay/dsh-agent/contract";
import { modelSelectionProjectionDefinition } from "@morlay/dsh-agent/contract";
import type { Session } from "@morlay/dsh-session/contract";
import type { ProjectionHandle } from "@morlay/dsh-session/contract";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { SessionMode } from "./contract/session-mode.contract.ts";
import { SessionScope } from "./contract/session-scope.contract.ts";
import type { ModeConfig } from "./endpoint/mode-config.ts";
import {
  POLICY_DESCRIPTIONS,
  POLICY_NAMES,
  type PolicyName,
  type SessionModeActiveState,
  type SessionModeDirectory,
  type SessionModeDirectoryEntry,
  type SessionModePatch,
  type SessionModeRoster,
  type SessionModeRow,
  type SessionModeTriState,
} from "./endpoint/session-mode-shapes.ts";
import { deniedByList, toolGroupLabel, toolGroupOf } from "./guidance/tool-groups.ts";

import { DEFAULT_MODE, MODE_SOURCES } from "./mode-sources.ts";
import { configProblem, normalizeMode, policyInForce, type ModeInput } from "./modes.ts";
import { installPersona } from "./persona.ts";
import { loadModeOverrides, removeMode, writeMode } from "./mode-store.ts";
import {
  agentPresetProjection,
  appendSelected,
  sessionModeEditableProjection,
  sessionModeProjection,
} from "./session-mode.projection.ts";

// 装配输入：`default` 与 `modes` 就是这条行的 config。
// `models` 是退役的顶层形状，留着只为装配期报错（见 `configProblem`）。
export interface SessionModeProviderConfig {
  readonly default?: string;
  readonly modes?: Readonly<Record<string, ModeInput>>;
  readonly models?: Readonly<Record<string, unknown>>;
  // 本部署唯一的 agent preset id：不再向官方 roster 询问（本部署只装它那一份行清单）。
  readonly preset?: string;
}

// 本部署唯一的 agent preset id 的缺省值。
export const DEFAULT_PRESET = "ptc";

function configWithDefaults(input: SessionModeProviderConfig): Required<SessionModeProviderConfig> {
  const configured = input.modes ?? {};
  const models = input.models ?? {};
  const preset = input.preset ?? DEFAULT_PRESET;
  if (Object.keys(configured).length === 0) {
    return {
      default: input.default ?? DEFAULT_MODE,
      modes: Object.fromEntries(MODE_SOURCES.map((source) => [source.id, source])),
      models,
      preset,
    };
  }
  return { default: input.default ?? DEFAULT_MODE, modes: configured, models, preset };
}

// 一个 agent 当前装着的那一份：模式变了就换一份，`dispose` 收干净它名下的注册。
interface Installed {
  dispose(): void;
}

@Injectable()
export class SessionModeDefault extends SessionMode implements OnInit {
  static Config = configWithDefaults;

  private readonly agents = inject(AgentDirectory);

  private readonly sessions = inject(SessionStore);

  private readonly registrations = inject(SessionProjectionStore);

  private readonly scope = inject(SessionScope);

  // 装配时的配置快照：改这两项靠重挂，已运行会话不自动换定义。
  private readonly config: Required<SessionModeProviderConfig>;

  private readonly definitions = new Map<string, ModeConfig>();

  private readonly installs = new WeakMap<Agent, Installed>();

  private readonly overrides = new WeakMap<Agent, ModeConfig>();

  private stateHandle: ProjectionHandle<string | null> | undefined;

  private editableHandle: ProjectionHandle<boolean> | undefined;

  private pendingModel: ProjectionHandle<{ readonly pending: unknown }> | undefined;

  // 官方 roster 的会话事实（`agentPreset`）：借它的定义读「这个会话挂着哪份 preset」。
  private presetHandle: ProjectionHandle<string | null> | undefined;

  // 构造只收 config（`onInit` 才给 ctx）：装配器按 `Config` 规范化之后只传这一个参数。
  constructor(config: SessionModeProviderConfig = {}) {
    super();
    this.config = configWithDefaults(config);
    const problem = configProblem({
      default: this.config.default,
      modes: this.config.modes,
      models: this.config.models,
    });
    if (problem !== undefined) throw new Error(problem);
    for (const [id, mode] of Object.entries(this.config.modes)) {
      this.definitions.set(id, normalizeMode(mode));
    }
  }

  get defaultId(): string {
    return this.config.default;
  }

  async onInit(ctx: Context): Promise<void> {
    // 用户自己的模式定义覆盖同 id 的模板（`noop` 是保留关键字，不能被覆盖）。
    for (const [id, value] of Object.entries(await loadModeOverrides())) {
      if (id === "noop") continue;
      const base = this.config.modes[id] ?? {};
      this.definitions.set(id, normalizeMode({ ...base, ...value } as ModeInput));
    }
    // 两份都用 `wire` 注册：客户端按投影读会话事实（`projectionValues.sessionMode`）。
    // 上游的 `SessionProjectionMap` 是可合并的，但本仓规范禁止给上游类型加成员——键的类型在注册这一处
    // 断言一次，运行期只读 `wire.view` / `wire.viewSchema`。
    this.stateHandle = (await this.registrations.register(
      sessionModeProjection as never,
    )) as unknown as ProjectionHandle<string | null>;
    this.editableHandle = (await this.registrations.register(
      sessionModeEditableProjection as never,
    )) as unknown as ProjectionHandle<boolean>;
    // `agentPreset` 归官方 roster：同样只借它的定义读会话事实（registry 没装时 header 里的值照旧可读）。
    this.presetHandle = (await this.registrations.register(
      agentPresetProjection(this.config.preset) as never,
    )) as unknown as ProjectionHandle<string | null>;
    // 上游那份 `modelSelection` 由 agent-loop 注册：这里拿同一个定义再注册一次只是要一个读句柄。
    this.pendingModel = (await this.registrations.register(
      modelSelectionProjectionDefinition,
    )) as unknown as ProjectionHandle<{ readonly pending: unknown }>;

    // 会话一建立就装上：早于它的第一次装配，persona 因此一定在装配之前注册好。
    ctx.on("agent/created", ({ agent }: { agent: Agent }) => {
      this.installFor(agent);
    });
    // 按模式的 policy 拦截：这三条 waterfall 上游 `fs-observation-policy` 独占决策槽，只能 `prepend` 抢在它前面。
    for (const policy of POLICY_NAMES) {
      ctx.on(
        policy,
        (_target: unknown, actor: unknown, next: () => unknown) =>
          this.decidePolicy(policy, actor, next as () => Promise<unknown>),
        { prepend: true },
      );
    }
  }

  list(): SessionModeRow[] {
    return this.idsFor("main").map((id) => {
      const mode = this.definition(id);
      return {
        id,
        name: mode.name,
        ...(mode.description === "" ? {} : { description: mode.description }),
      };
    });
  }

  idsFor(role: "main" | "subagent"): string[] {
    return [...this.definitions.entries()]
      .filter(([, mode]) => mode.role.includes(role))
      .map(([id]) => id);
  }

  modesFor(role: "main" | "subagent"): { id: string; mode: ModeConfig }[] {
    return this.idsFor(role).map((id) => ({ id, mode: this.definition(id) }));
  }

  roster(): SessionModeRoster {
    return { default: this.defaultId, modes: this.list() };
  }

  definition(id?: string): ModeConfig {
    const wanted = id ?? this.defaultId;
    const mode = this.definitions.get(wanted);
    if (mode === undefined) {
      throw new Error(
        `未知的模式 ${JSON.stringify(wanted)}；可用的是 ${[...this.definitions.keys()].join(", ")}`,
      );
    }
    return mode;
  }

  selectedOf(session: Session): string | null {
    return this.stateHandle?.stateOf(session) ?? null;
  }

  modeOf(session: Session): string {
    return this.selectedOf(session) ?? this.defaultId;
  }

  modeOfSession(session: Session): ModeConfig {
    return this.definition(this.modeOf(session));
  }

  editableOf(session: Session): boolean {
    return this.editableHandle?.stateOf(session) ?? true;
  }

  knownToolsOf(agent: Agent): readonly string[] {
    return this.scope.knownTools(agent);
  }

  modeForPreset(preset: string | undefined): string | undefined {
    if (preset === undefined) return undefined;
    const owners = [...this.definitions.entries()]
      .filter(([, mode]) => mode.presetsOnly.includes(preset))
      .map(([id]) => id);
    return owners.length === 1 ? owners[0] : undefined;
  }

  async select(sessionId: SessionId, mode: string): Promise<string> {
    const definition = this.definition(mode);
    if (!definition.role.includes("main")) {
      throw new Error(`模式 ${JSON.stringify(mode)} 不是用户可选的（它的 role 里没有 main）。`);
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error(`未知的会话 ${sessionId}`);
    if (!this.editableOf(session)) {
      throw new Error("这个会话已经开始，模式不能再改；要换模式请新开一个会话。");
    }
    // 不换 preset：本部署只装 config.preset 那一份行清单，会话建好就已经是它。
    const agent = this.agents.get(sessionId);
    if (this.selectedOf(session) !== mode) appendSelected(session, mode);
    if (agent !== undefined) this.installFor(agent, mode);
    return mode;
  }

  applyTo(agent: Agent, mode: string, options: { record?: boolean } = {}): void {
    this.definition(mode);
    if (options.record !== false) appendSelected(agent.session, mode);
    this.installFor(agent, mode);
  }

  async activeState(sessionId: SessionId): Promise<SessionModeActiveState | undefined> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return undefined;
    const agent = this.agents.get(sessionId);
    const id = this.modeOf(session);
    const base = this.definition(id);
    const override = agent === undefined ? undefined : this.overrides.get(agent);
    const effective = this.effectiveOf(agent, id);
    return {
      mode: { id, name: base.name, description: base.description },
      // `config` 是**当下生效**的那一份（模式默认 + 会话覆盖）；`session` 只记覆盖了哪些字段。
      config: effective,
      session: override === undefined ? undefined : structuredClone(override),
      overriddenFields:
        override === undefined
          ? []
          : (Object.keys(override) as (keyof ModeConfig)[]).filter(
              (key) => JSON.stringify(override[key]) !== JSON.stringify(base[key]),
            ),
      catalog: await this.buildCatalog(agent, base, effective),
      editable: this.editableOf(session),
      deletable: id !== this.defaultId && this.definitions.size > 1,
    };
  }

  async setModePatch(
    sessionId: SessionId,
    patch: SessionModePatch,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return undefined;
    const next: Record<string, unknown> = { ...this.overrides.get(agent) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) Reflect.deleteProperty(next, key);
      else next[key] = value;
    }
    this.overrides.set(agent, next as unknown as ModeConfig);
    this.installFor(agent);
    return this.activeState(sessionId);
  }

  async setSwitches(
    sessionId: SessionId,
    patch: Readonly<Partial<Record<"instructions" | "skills" | "runtimeContext", boolean | null>>>,
  ): Promise<SessionModeActiveState | undefined> {
    return this.setModePatch(sessionId, patch as SessionModePatch);
  }

  async applyConfig(
    sessionId: SessionId,
    config: ModeConfig,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return undefined;
    this.overrides.set(agent, structuredClone(config));
    this.installFor(agent);
    return this.activeState(sessionId);
  }

  async saveConfig(
    sessionId: SessionId,
    config: ModeConfig,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return undefined;
    const modeId = this.modeOf(agent.session);
    const next = normalizeMode(config as unknown as ModeInput);
    this.definitions.set(modeId, next);
    await writeMode(modeId, plainMode(next));
    this.overrides.delete(agent);
    this.installFor(agent, modeId);
    return this.activeState(sessionId);
  }

  async saveAsDefault(sessionId: SessionId): Promise<SessionModeActiveState | undefined> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return undefined;
    if (this.overrides.get(agent) === undefined) return this.activeState(sessionId);
    const modeId = this.modeOf(agent.session);
    // 写回的是**当前生效配置**（模式定义 + 会话覆盖），不是覆盖那几项：写盘的定义要是完整的一份。
    const effective = this.effectiveOf(agent, modeId);
    this.definitions.set(modeId, structuredClone(effective));
    await writeMode(modeId, plainMode(effective));
    // 覆盖保留：写回默认不该把当前会话立刻退回旧默认（它刚被写进定义，生效态本来就不变）。
    this.installFor(agent, modeId);
    return this.activeState(sessionId);
  }

  async saveAsNewMode(sessionId: SessionId, code: string, name?: string): Promise<string> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) throw new Error("会话不存在。");
    const id = code.trim();
    if (id.length === 0) throw new Error("模式 code 不能为空。");
    if (!/^[a-zA-Z0-9_-]+$/u.test(id))
      throw new Error("模式 code 只能包含字母、数字、下划线与连字符。");
    if (this.definitions.has(id)) throw new Error(`模式 ${id} 已存在。`);
    const merged = this.effectiveOf(agent, this.modeOf(agent.session));
    const next = normalizeMode({ ...merged, name: name?.trim() || id } as ModeInput);
    this.definitions.set(id, next);
    await writeMode(id, plainMode(next));
    return id;
  }

  async deleteMode(sessionId: SessionId): Promise<string> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) throw new Error("会话不存在。");
    const modeId = this.modeOf(agent.session);
    if (modeId === this.defaultId) throw new Error("部署默认模式不能删除。");
    const remaining = [...this.definitions.keys()].filter((id) => id !== modeId);
    if (remaining.length === 0) throw new Error("至少要留一个模式。");
    this.definitions.delete(modeId);
    await removeMode(modeId);
    this.overrides.delete(agent);
    if (this.selectedOf(agent.session) === modeId) appendSelected(agent.session, this.defaultId);
    this.installFor(agent, this.defaultId);
    return this.defaultId;
  }

  // 这个会话**实际生效**的模式定义：模式配置 + 会话覆盖（覆盖是字段级的，缺的字段跟模式默认）。
  private effectiveOf(agent: Agent | undefined, modeId: string): ModeConfig {
    const base = this.definition(modeId);
    const override = agent === undefined ? undefined : this.overrides.get(agent);
    return override === undefined
      ? structuredClone(base)
      : { ...structuredClone(base), ...override };
  }

  // 装配或换掉该 agent 的那一份（同一模式重复 applyTo 会重装一次，收口本身是幂等的）。
  private installFor(agent: Agent, modeId: string = this.resolveModeId(agent)): void {
    this.installs.get(agent)?.dispose();
    const mode = this.effectiveOf(agent, modeId);
    const account = this.scope.account(agent);
    account.add(installPersona(agent, mode.persona));
    account.add(this.installDefaultModel(agent, modeId));
    this.scope.apply(agent, {
      name: mode.name,
      allowTools: mode.allowTools,
      denyTools: mode.denyTools,
      allowSkills: mode.allowSkills,
      denySkills: mode.denySkills,
      instructions: mode.instructions,
      skills: mode.skills,
      runtimeContext: mode.runtimeContext,
      dropSections: mode.dropSections,
    });
    this.installs.set(agent, { dispose: () => account.release() });
  }

  // 该 agent 用哪个模式：会话选过（投影上有）优先，子代理继承父，其余用部署默认。
  //
  // 继承与官方 roster 的映射会写进子会话日志（它是一条会话事实，冷恢复与 fork 靠它重建）；
  // **回落部署默认不写**——没选过的会话 `selectedOf` 就该是 `null`，`modeOf` 在它之上落默认。
  private resolveModeId(agent: Agent): string {
    const selected = this.selectedOf(agent.session);
    if (selected !== null) return selected;
    const mapped = this.modeForPreset(this.presetOf(agent.session));
    if (mapped !== undefined) {
      appendSelected(agent.session, mapped);
      return mapped;
    }
    const inherited = this.inheritedModeId(agent);
    if (inherited === undefined) return this.defaultId;
    appendSelected(agent.session, inherited);
    return inherited;
  }

  // 这个会话挂着哪份 preset：本行自己的最小投影（读 header，缺省是 config 那一个）。
  private presetOf(session: Session): string | undefined {
    const state = this.presetHandle?.stateOf(session);
    return typeof state === "string" ? state : undefined;
  }

  // 子代理（有 durable 父会话）继承父当前模式。
  private inheritedModeId(agent: Agent): string | undefined {
    const parentId = agent.session.header.parentSession;
    if (parentId === undefined) return undefined;
    const parent = this.agents.get(parentId);
    return parent === undefined ? undefined : this.modeOf(parent.session);
  }

  // 默认模型兜底：只在会话尚无任何模型事实时接管这一请求的路由（配置事实，不写会话事件）。
  private installDefaultModel(agent: Agent, modeId: string): () => void {
    const agentCtx = agent.ctx as unknown as Context;
    return agentCtx.on("agent/request", async (_payload: unknown, next: () => Promise<unknown>) => {
      const resolved = (await next()) as Record<string, unknown>;
      const model = this.definition(modeId).defaultModel;
      if (model === undefined) return resolved;
      const pending = this.pendingModel?.stateOf(agent.session).pending;
      if (pending !== undefined && pending !== null) return resolved;
      if (agent.session.requestHeader() !== undefined) return resolved;
      return {
        ...resolved,
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
      };
    }) as unknown as () => void;
  }

  // 一条 policy 规则在**这次调用**里还生效吗（`true` = 交给上游）。认不出 agent 时一律按"没配"读。
  private policyOf(policy: PolicyName, actor: unknown): boolean {
    const agent = (actor as { readonly agent?: Agent } | undefined)?.agent;
    if (agent === undefined) return true;
    const modeId = this.modeOf(agent.session);
    if (!this.definitions.has(modeId)) return true;
    return policyInForce(this.effectiveOf(agent, modeId), policy);
  }

  // 规则生效就原样交给上游；被禁用就先让上游算完再丢掉结论（连它抛出的拒绝一起）。
  private async decidePolicy<T>(
    policy: PolicyName,
    actor: unknown,
    next: () => Promise<T>,
  ): Promise<T | undefined> {
    if (this.policyOf(policy, actor)) return await next();
    try {
      await next();
    } catch {
      // 上游的拒绝是这次裁决的一部分：禁用就是连它一起不要。
    }
    return undefined;
  }

  // 全量目录 + 会话覆盖的三态：面板的折叠组读它。
  private async buildCatalog(
    agent: Agent | undefined,
    base: ModeConfig,
    effective: ModeConfig,
  ): Promise<SessionModeDirectory> {
    const entry = (
      id: string,
      description: string,
      group: string | undefined,
      allowKey: "allowTools" | "allowSkills" | "allowPolicies",
      denyKey: "denyTools" | "denySkills" | "denyPolicies",
    ): SessionModeDirectoryEntry => {
      const fallback: SessionModeTriState | "default" = deniedByList(base[denyKey], id)
        ? "deny"
        : base[allowKey].length > 0
          ? base[allowKey].includes(id)
            ? "allow"
            : "deny"
          : "default";
      const baseDeny = deniedByList(base[denyKey], id);
      const effDeny = deniedByList(effective[denyKey], id);
      const override: SessionModeTriState | null =
        baseDeny !== effDeny
          ? effDeny
            ? "deny"
            : "allow"
          : base[allowKey].includes(id) !== effective[allowKey].includes(id)
            ? effective[allowKey].includes(id)
              ? "allow"
              : "deny"
            : null;
      return {
        id,
        description,
        ...(group === undefined ? {} : { group, groupLabel: toolGroupLabel(group) }),
        fallback,
        override,
      };
    };
    const tools = agent === undefined ? [] : this.scope.catalogOf(agent);
    const skills = agent === undefined ? [] : await this.scope.skillCatalog(agent);
    return {
      tools: tools.map((tool) =>
        entry(tool.name, tool.description, toolGroupOf(tool.name), "allowTools", "denyTools"),
      ),
      skills: skills.map((skill) =>
        entry(skill.name, skill.description, undefined, "allowSkills", "denySkills"),
      ),
      policies: POLICY_NAMES.map((policy) =>
        entry(policy, POLICY_DESCRIPTIONS[policy], undefined, "allowPolicies", "denyPolicies"),
      ),
    };
  }
}

// TOML 不能表示 undefined：写盘前把空值字段剔掉。
function plainMode(value: ModeConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
