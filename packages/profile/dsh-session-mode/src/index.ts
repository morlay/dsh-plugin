// 会话模式的 host 半：模式清单（config 里的纯数据）、会话 ↔ 模式的选择、按会话应用 persona 与**收口**。模式是一份
// 数据，应用落在会话自己的 scope 上（persona + 工具收口与三个注入开关，见 `./scope.ts`），默认模型住在
// `modes.<id>.defaultModel`；换模式只允许在空白窗口。取舍见 `.agents/designs/20260924-会话模式.md`。

import { Service, type Context } from "@deepseek-ai/cordis";
import { modelSelectionProjectionDefinition } from "@deepseek-ai/dsh-agent";
import type { Agent } from "@deepseek-ai/dsh-agent";
// 会话级模型事实（投影 `modelSelection` 与事件 `model/selection`）由上游 session-controller 声明；
// 那一行可能没装（headless 部署），所以读它时按"可能为空"处理。
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { ReasoningEffortId, type LlmCallConfig } from "@deepseek-ai/dsh-llm";
import { type Session, type SessionEvent, type SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session";
import { agentPresetProjectionDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import type { ProjectionDefinition, ProjectionHandle } from "@deepseek-ai/dsh-session-projection";
import type {} from "@deepseek-ai/dsh-session-projection";
// 官方 roster 的会话投影（`agentPreset`）：选择面归官方 preset，我们读它的选择、落成自己的会话事实。
// Type-only：上游 fs 的 policy 事件词汇（`fs/write-intent` / `fs/edit-intent` 的签名与 `FsWriteIntent`）。
import type {} from "@deepseek-ai/dsh-fs";
import { z } from "zod";
import { MODE_SOURCES } from "./mode-sources.ts";
import { modeConfig } from "./rows.ts";
import {
  configProblem,
  derivedSkills,
  type ResolvedConfig,
  type SessionMode,
  type SessionModeRole,
} from "./modes.ts";
import { SessionModeCatalog } from "./catalog.ts";
import { normalizeMode } from "./modes.ts";
import { installPersona } from "./persona.ts";
import { SessionScope } from "./scope.ts";
import {
  asModeConfig,
  resolveModeConfig,
  type ModeConfig,
  type ModeSession,
} from "./mode-config.ts";
import { loadModeOverrides, removeMode, writeMode } from "./mode-store.ts";
import { sessionModeDomainSpec } from "./session-mode-store.ts";
import {
  POLICY_DESCRIPTIONS,
  POLICY_NAMES,
  toolGroupLabel,
  toolGroupOf,
  deniedByList,
  SESSION_MODE_PATH,
  type PolicyName,
  type SessionModeActiveState,
  type SessionModeRoster,
  type SessionModeRow,
  type SessionModeSelectResult,
  type SessionModeSwitchKey,
  type SessionModeEditable,
  type SessionModeDirectory,
  type SessionModeDirectoryEntry,
  type SessionModeTriState,
} from "./shared.ts";

// Cordis 插件名：与行 id 一致。
export const name = "session-mode";

// 这些名字必须在 `inject` 里点名：cordis 的属性访问（`this.ctx.sessions`）要求本 fiber 声明过那个服务，
// 未声明会抛 `cannot get property "sessions" without inject`（`ctx.get(name)` 才不需要声明）。
export const inject = ["agents", "sessions", "sessionProjections", "systemPrompt"];

export { Config } from "./modes.ts";
export type {
  ResolvedConfig,
  SessionMode,
  SessionModeModel,
  SessionModePersona,
  SessionModeRole,
} from "./modes.ts";
export { SESSION_MODE_PATH } from "./shared.ts";

// 面板能改的那几项；`null` = 清掉这一项的会话覆盖、回到模式默认。
export type SwitchPatch = Partial<Record<SessionModeSwitchKey, boolean | null>>;
export type ModePatch = Partial<Record<keyof SessionModeEditable, unknown>>;

// TOML 不能表示 undefined：写盘前把空值字段剔掉。
function plainMode(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

// 会话级**逐条目**覆盖：不碰模式的 allow/deny 名单，没配就是默认。
export type ItemKind = "tools" | "skills" | "policies";
export { POLICY_NAMES } from "./shared.ts";
export type { PolicyName, SessionModeRoster, SessionModeRow } from "./shared.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessionModes: SessionModes;
  }
}

declare module "@deepseek-ai/dsh-session/types" {
  // 会话级覆盖是**插件记录**：旧 harness 不认识时按 ignorable 跳过，而不是拒绝整份日志。
  interface SessionEventMap {
    // 会话在空白窗口里换了模式；**log-only**，恢复与 fork 据此重建（模式决定模型看到的工具与提示词）。
    "session-mode/selected": { sessionMode: string };
  }
}

declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionStateMap {
    sessionMode: string | null;
    sessionModeEditable: boolean;
  }
  interface SessionProjectionMap {
    // 会话当前模式；`null` 表示没选过（用部署默认）。
    sessionMode: string | null;
    // 会话还能不能换模式：`true` 是选择器，`false` 是只读标签（client 那个 chip 据此变形）。
    sessionModeEditable: boolean;
  }
}

const sessionModeSchema: z.ZodType<string | null> = z.union([z.string(), z.null()]);

// 会话模式的投影：初值来自空日志（没选过就是 `null`），只被选择事件推进。
export const sessionModeProjection = {
  key: "sessionMode",
  stateSchema: sessionModeSchema,
  init: () => null,
  apply: (state: string | null, event: SessionEvent) =>
    event.type === "session-mode/selected" ? event.data.sessionMode : state,
  wire: { viewSchema: sessionModeSchema, view: (state: string | null) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<"sessionMode", string | null>;

const sessionModeEditableSchema: z.ZodType<boolean> = z.boolean();

// 这个会话能不能换模式的投影：空白会话为 `true`，`turn/start` 一落库就永远 `false`（换模式要的是整段历史的
// 模式一致）。判据只有这一处——服务端拒绝与 client chip 的只读形态都读它。
export const sessionModeEditableProjection = {
  key: "sessionModeEditable",
  stateSchema: sessionModeEditableSchema,
  init: () => true,
  apply: (state: boolean, event: SessionEvent) => state && event.type !== "turn/start",
  wire: { viewSchema: sessionModeEditableSchema, view: (state: boolean) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<"sessionModeEditable", boolean>;

// 模式清单、默认模式、按会话读取与切换。
export class SessionModes extends Service {
  // 每个 agent 已经装上的那一份（persona + 默认模型兜底；模式变了就换一份）。
  private readonly installs = new WeakMap<Agent, { mode: string; dispose: () => void }>();
  // 会话级的注入开关覆盖（面板上改的那三个）：只活在这个进程里；"保存为默认"把它写回模式配置。
  private readonly modeOverrides = new WeakMap<Agent, ModeSession>();
  // 会话覆盖的持久化表（storageDomain，与投影缓存同一层）。
  private sessionsTable:
    | {
        get(id: SessionId): { config: Record<string, unknown> } | undefined;
        put(id: SessionId, value: { config: Record<string, unknown> }): void;
        delete(id: SessionId): void;
      }
    | undefined;
  // 逐条目三态：没配就是"跟着模式的默认"。

  // 按会话收口：工具名单、instruction / 技能目录 / 动态快照三个开关。它由本行**内部持有**（不发布服务）——收口的
  // 输入就是模式定义、唯一消费者也是模式。
  private readonly scope: SessionScope;

  // 会话投影的读句柄（上游 0.2.1-rc.2 起 `register()` 是异步的，读状态要拿着那次注册的 handle；
  // 全局的 `stateOf(session, key)` 已弃用）。前两个是本包自己的投影，后两个是上游的（同一份定义重复注册
  // 只是共享同一个 unit，不改变它的行为）。
  private projectionHandle!: ProjectionHandle<string | null>;
  private editableHandle!: ProjectionHandle<boolean>;
  private modelSelectionHandle!: ProjectionHandle<{
    readonly pending: unknown;
    readonly lastUsed: unknown;
  }>;
  private agentPresetHandle!: ProjectionHandle<string | null>;

  // 装配时的配置快照：`default` / `modes` 读它，改这两项靠 Loader 重挂这一行（已运行会话不自动换定义）。
  readonly config: {
    default: string;
    modes: Record<string, SessionMode>;
  };

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, "sessionModes");
    // 校验看的是**值**：字段解析后都是稳定引用，`configProblem` 只认普通对象。
    // 快照取一份**可变**副本：volatile 的快照是深度只读，而内部按普通配置对象用（写回不走这里，改配置靠重挂）。
    this.config = {
      default: config.default.get(),
      // 模式定义不走 cordis 配置：内置默认 + `{dshHome}/modes/*.toml`（`init` 里填）。
      // 装配期注入（测试/高级用法）单存一份，`init` 时覆盖内置默认。
      modes: structuredClone(config.modes ?? {}) as Record<string, SessionMode>,
    };
    // 退役的顶层 `models` 还配着值就让装配期报错。
    const problem = configProblem({ ...this.config, models: config.models });
    if (problem !== undefined) throw new Error(problem);
    this.scope = new SessionScope(ctx);
    // 按模式的 policy 拦截：两条上游 waterfall 各 `prepend` **一次**，注册在行 ctx 上、随行卸载一起撤。
    //
    // 接缝为什么只有这一种：fs 的调用是 `ctx.waterfall('fs/write-intent', target, actor, next)`——事件名在第一个
    // 参数上，而 cordis 只在"第一个参数是对象 / 函数"时才取接收者并按 scope 过滤，所以这两条 waterfall 上
    // **没有 scope 过滤**：注册在该 agent 的 ctx 上买不到隔离，只会多 N 份判断。归属只能从 `actor.agent` 认
    // （工具把自己的 exec 当 actor 传进来），模式的判据每次调用**现算**——于是切模式 / `applyTo` / 子代理继承
    // 都不需要换监听器，"重复应用不重复注册"是结构上的事，不靠判等维持。
    //
    // 位置：上游 `fs-observation-policy` 在这两条 waterfall 上**独占决策槽**（它不调 `next()`），所以链首只能靠
    // `prepend` 抢——站在它后面就没有决策权。这份实现的前提就是这条契约（见
    // `.agents/designs/20260929-按模式的policy拦截.md`）。
    ctx.on(
      // `satisfies PolicyName`：注册的事件名与 `POLICY_NAMES`（装配期校验与页面候选键读的同一份名单）必须在类型面
      // 对得上——名单里删掉一个名字，这里就编不过，而不是静默拦不住。
      "fs/write-intent" satisfies PolicyName,
      (_target, actor, next) => this.decidePolicy("fs/write-intent", actor, next),
      { prepend: true },
    );
    ctx.on(
      "fs/edit-intent" satisfies PolicyName,
      (_target, actor, next) => this.decidePolicy("fs/edit-intent", actor, next),
      { prepend: true },
    );
    // 删除那条也走同一个决策面：上游 `fs-observation-policy` 在这里同样独占决策槽，所以仍用 `prepend` 抢在它前面。
    ctx.on(
      "fs/delete-intent" satisfies PolicyName,
      (_target, actor, next) => this.decidePolicy("fs/delete-intent", actor, next),
      { prepend: true },
    );
    // 会话一建立就装上：这早于它的第一次装配，persona 因此一定在装配之前注册好。
    ctx.on("agent/created", ({ agent }) => {
      this.installFor(agent);
    });
    // 官方 roster 换 preset 时把该会话的扩展换成新 preset 那一份（先落成会话事实再重装）；
    // 只在 preset → 模式的映射唯一时动手（共享同一份 preset 时反查无意义）。
    ctx.on("agent-preset/selected", (sessionId: SessionId, preset: string) => {
      const mapped = this.modeForPreset(preset);
      const agent = ctx.agents.get(sessionId);
      if (mapped === undefined || agent === undefined) return;
      if (this.projectionHandle.stateOf(agent.session) !== mapped) {
        agent.session.append("session-mode/selected", { sessionMode: mapped });
      }
      this.installFor(agent, mapped);
    });
  }

  // 构造即注册（`init` 是异步的）：入口 `apply` 走这条异步工厂。
  static async create(ctx: Context, config: ResolvedConfig): Promise<SessionModes> {
    // 内置默认必须在**构造之前**就位：构造期校验要确认 `default` 落在已知的模式集合里，而行 config 现在
    // 只带 `default`（模式定义走 `{dshHome}/modes/*.toml`）。装配期注入（测试 / 高级用法）给了 modes 就整份用，
    // 不掺内置默认。
    const injected = config.modes ?? {};
    const modes =
      Object.keys(injected).length === 0
        ? (Object.fromEntries(
            MODE_SOURCES.map((source) => [source.id, normalizeMode(modeConfig(source))]),
          ) as Record<string, SessionMode>)
        : injected;
    const sessionModes = new SessionModes(ctx, { ...config, modes });
    await sessionModes.init();
    return sessionModes;
  }

  // 注册投影并拿读句柄。`register()` 要 await：句柄与注册同生命期（行卸载时自动释放），而读状态只能经句柄。
  private async init(): Promise<void> {
    // 用户自己的模式定义（`{dshHome}/modes/*.toml`）覆盖已就位的那份 modes——内置默认由 `create` 在构造前补上。
    const modes = this.config.modes as Record<string, SessionMode>;
    for (const [id, value] of Object.entries(await loadModeOverrides())) {
      // `noop` 是保留关键字：用户文件不能覆盖它。
      if (id === "noop") continue;
      // TOML 是部分字段：合并模板后过一遍 schema，新加的模式才有齐全的字段。
      modes[id] = normalizeMode({ ...modes[id], ...value });
    }
    // 会话覆盖的持久化：harness 的存储域（与投影缓存同一层），按 sessionId 存一份配置。
    // 没有这个服务（例如单测装配）时退化为纯内存，会话关闭即丢。
    const storage = this.ctx.get("storageDomain") as unknown as
      | {
          open(spec: typeof sessionModeDomainSpec): Promise<{
            close(): Promise<void>;
            table(name: "sessions"): NonNullable<SessionModes["sessionsTable"]>;
          }>;
        }
      | undefined;
    if (storage !== undefined) {
      const domain = await storage.open(sessionModeDomainSpec);
      this.ctx.effect(() => () => domain.close(), "session-mode.domainClose");
      this.sessionsTable = domain.table("sessions");
    }
    this.projectionHandle = await this.ctx.sessionProjections.register(sessionModeProjection);
    this.editableHandle = await this.ctx.sessionProjections.register(sessionModeEditableProjection);
    // 上游那份 `modelSelection` 由 agent-loop 注册；这里拿同一个定义再注册一次只是要一个读句柄
    // （refs 共享，卸载时我们这一份跟着减回去）。headless 部署里 agent-loop 也在，所以 key 一定有人注册。
    this.modelSelectionHandle = await this.ctx.sessionProjections.register(
      modelSelectionProjectionDefinition,
    );
    // `agentPreset` 归官方 roster；同样只借它的定义读会话事实（registry 没装时 header 里的值照旧可读）。
    this.agentPresetHandle = await this.ctx.sessionProjections.register(
      agentPresetProjectionDefinition,
    );
  }

  // 新会话用它：config 里的 `default`。
  get defaultId(): string {
    return this.config.default;
  }

  // 选择器要的清单：只列 `main` 角色的模式（id、展示名、说明，顺序即 config 里 `modes` 的插入序）。
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

  // 声明了某个角色的模式 id（顺序即 config 的插入序）：`main` 给用户选择器，`subagent` 给子代理候选。
  idsFor(role: SessionModeRole): string[] {
    return Object.entries(this.config.modes)
      .filter(([, mode]) => mode.role.includes(role))
      .map(([id]) => id);
  }

  // 同 `idsFor`，给的是定义——"指定 mode" 那条接缝要拿候选集。
  modesFor(role: SessionModeRole): { id: string; mode: SessionMode }[] {
    return this.idsFor(role).map((id) => ({ id, mode: this.definition(id) }));
  }

  // 页面用的清单 + 默认模式。
  roster(): SessionModeRoster {
    return { default: this.defaultId, modes: this.list() };
  }

  // 按 id 取定义；未知 id 直接抛（切换路径上它就是用户的错）。
  definition(id?: string): SessionMode {
    const wanted = id ?? this.defaultId;
    const mode = this.config.modes[wanted];
    if (mode === undefined) {
      throw new Error(
        `未知的模式 ${JSON.stringify(wanted)}；可用的是 ${Object.keys(this.config.modes).join(", ")}`,
      );
    }
    return mode;
  }

  // 会话自己选过的模式（投影原值；没选过是 null）。`modeOf` 在它之上落部署默认。
  selectedOf(session: Session): string | null {
    return this.projectionHandle.stateOf(session);
  }

  // 会话当前模式：投影上有就用它，否则是部署默认。
  modeOf(session: Session): string {
    const selected = this.projectionHandle.stateOf(session);
    return selected ?? this.defaultId;
  }

  // 这个会话还能不能换模式（空白窗口）：投影 `sessionModeEditable` 的读口。
  // 页面 chip 的只读形态与服务端的拒绝判据都读它。
  editableOf(session: Session): boolean {
    return this.editableHandle.stateOf(session);
  }

  // 每一条目的三态：模式默认下的判定 + 这个会话是否显式覆盖了它。
  private buildCatalog(
    agent: Agent | undefined,
    base: SessionMode,
    merged: SessionMode,
    registered: readonly { name: string; description: string }[],
    visible: readonly { name: string; description?: string }[],
  ): SessionModeDirectory {
    const entry = (
      id: string,
      description: string,
      group: string | undefined,
      allowKey: "allowTools" | "allowSkills" | "allowPolicies",
      denyKey: "denyTools" | "denySkills" | "denyPolicies",
    ): SessionModeDirectoryEntry => {
      // `fallback` 反映**配置**：显式禁止（含组引用）→ deny；白名单内 → allow；白名单外 → deny；没配 → default。
      const fallback: SessionModeTriState | "default" = deniedByList(base[denyKey], id)
        ? "deny"
        : base[allowKey].length > 0
          ? base[allowKey].includes(id)
            ? "allow"
            : "deny"
          : "default";
      return {
        id,
        description,
        ...(group === undefined ? {} : { group, groupLabel: toolGroupLabel(group) }),
        fallback,
        // override = 生效值与配置值不一致时的那一档（会话覆盖就是 `ModeSession` 本身）。
        override: (() => {
          const baseDeny = deniedByList(base[denyKey], id);
          const effDeny = deniedByList(merged[denyKey], id);
          if (baseDeny !== effDeny) return effDeny ? ("deny" as const) : ("allow" as const);
          const baseAllow = base[allowKey].includes(id);
          const effAllow = merged[allowKey].includes(id);
          if (baseAllow !== effAllow) return effAllow ? ("allow" as const) : ("deny" as const);
          return null;
        })(),
      };
    };
    // 收口时抓的全量目录 + 之后才注册的可见工具（agent-team 这类 scoped 工具），同一名字只留一份。
    const known = new Map<string, { name: string; description: string }>();
    if (agent !== undefined) {
      for (const tool of this.scope.catalogOf(agent)) known.set(tool.name, tool);
      for (const tool of visible) {
        if (!known.has(tool.name)) {
          known.set(tool.name, { name: tool.name, description: tool.description ?? "" });
        }
      }
    }
    const tools = [...known.values()].map((tool) =>
      entry(tool.name, tool.description, toolGroupOf(tool.name), "allowTools", "denyTools"),
    );
    const toolIds = new Set(tools.map((tool) => tool.id));
    const fsActive = ["read", "write", "edit", "apply_patch"].some((id) => toolIds.has(id));
    return {
      tools,
      skills: registered.map((skill) =>
        entry(skill.name, skill.description, undefined, "allowSkills", "denySkills"),
      ),
      // 两条 policy 都作用于文件工具：这个会话连一件文件工具都没有时，它们"不适用"，按禁止显示。
      policies: POLICY_NAMES.map((policy) => {
        const row = entry(
          policy,
          POLICY_DESCRIPTIONS[policy],
          undefined,
          "allowPolicies",
          "denyPolicies",
        );
        return fsActive ? row : { ...row, fallback: "deny" as const, override: null };
      }),
    };
  }

  // 这个会话在模式名单收窄之后"程序内可用"的工具名（给 `tool-guidance` 的注入判据用）。
  knownToolsOf(agent: Agent): readonly string[] {
    return this.scope.knownTools(agent);
  }

  // 会话当前模式的定义。
  modeOfSession(session: Session): SessionMode {
    return this.definition(this.modeOf(session));
  }

  // 会话覆盖的持久化：**不写会话日志**，落在 `storageDomain` 的 `session_mode` 域（按 `SessionId` 一行）。
  private record(agent: Agent): void {
    const session = this.modeOverrides.get(agent);
    if (this.sessionsTable === undefined) return;
    if (session === undefined) this.sessionsTable.delete(agent.session.id);
    else this.sessionsTable.put(agent.session.id, { config: { ...session } });
  }

  // 进入会话时把覆盖读回来（异步，读到后重装一次）。
  private hydrate(agent: Agent): void {
    if (this.modeOverrides.has(agent) || this.sessionsTable === undefined) return;
    const row = this.sessionsTable.get(agent.session.id);
    if (row === undefined) return;
    this.modeOverrides.set(agent, row.config as unknown as ModeSession);
    const modeId = this.resolveModeId(agent);
    this.installs.get(agent)?.dispose();
    this.installs.delete(agent);
    this.installFor(agent, modeId);
  }

  // 一次应用整份会话覆盖（面板的"应用到会话"）：`ModeSession` 直接落，只重装一次。
  // 一次应用整份会话覆盖（面板的"应用到会话"）：参数就是一份完整的 `ModeConfig`。
  // 把草稿写回**配置**（面板的"保存为默认"）：只动模式的配置，不把会话覆盖混进来。
  async saveConfig(
    sessionId: SessionId,
    config: ModeConfig,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) return undefined;
    const modeId = this.modeOf(agent.session);
    (this.config.modes as Record<string, SessionMode>)[modeId] = config as unknown as SessionMode;
    await writeMode(modeId, plainMode({ ...config }));
    this.modeOverrides.delete(agent);
    this.record(agent);
    this.installs.get(agent)?.dispose();
    this.installs.delete(agent);
    this.installFor(agent, modeId);
    return this.activeState(sessionId);
  }

  async applyConfig(
    sessionId: SessionId,
    config: ModeConfig,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) return undefined;
    this.modeOverrides.set(agent, structuredClone(config));
    this.record(agent);
    const modeId = this.resolveModeId(agent);
    this.installs.get(agent)?.dispose();
    this.installs.delete(agent);
    this.installFor(agent, modeId);
    return this.activeState(sessionId);
  }

  // 逐条目三态：`null` 清掉覆盖、回到模式默认。
  // 这个会话可见的工具名全集（含被收窄的）：组引用展开要用。
  private toolNames(agent: Agent): readonly string[] {
    const tools = this.ctx.get("tools") as unknown as
      | { definitions(): readonly { name: string }[] }
      | undefined;
    const known = new Set((tools?.definitions() ?? []).map((tool) => tool.name));
    for (const tool of this.scope.catalogOf(agent)) known.add(tool.name);
    return [...known];
  }

  // 模式的可编辑面（面板的默认值与"另存为"的底稿）。
  private editableFaceOf(mode: SessionMode): SessionModeEditable {
    return {
      persona: { ...mode.persona },
      allowTools: [...mode.allowTools],
      denyTools: [...mode.denyTools],
      allowSkills: [...mode.allowSkills],
      denySkills: [...mode.denySkills],
      allowPolicies: [...mode.allowPolicies],
      denyPolicies: [...mode.denyPolicies],
      instructions: mode.instructions,
      skills: mode.skills ?? true,
      runtimeContext: mode.runtimeContext,
    };
  }

  // 这个会话实际生效的模式定义：配置 + 会话覆盖（`ModeSession`），没有第二套逐条目结构。
  private definitionFor(agent: Agent, modeId: string): SessionMode {
    const base = this.definition(modeId);
    const normalized = asModeConfig(base, base.skills ?? true);
    const session = this.modeOverrides.get(agent);
    // 覆盖是**全量**的一份配置；旧日志里可能缺字段，按配置补齐后再用。
    return resolveModeConfig(
      normalized,
      session === undefined ? undefined : { ...normalized, ...session },
    );
  }

  // 会话级覆盖里那几项（只列还覆盖着的）。
  private overriddenKeys(agent: Agent | undefined): SessionModeSwitchKey[] {
    if (agent === undefined) return [];
    const override = this.modeOverrides.get(agent);
    if (override === undefined) return [];
    return (Object.keys(override) as SessionModeSwitchKey[]).filter(
      (key) => override[key] !== undefined,
    );
  }

  private overriddenFields(agent: Agent | undefined): string[] {
    if (agent === undefined) return [];
    const override = this.modeOverrides.get(agent);
    return override === undefined ? [] : Object.keys(override);
  }

  // 改这个会话的可编辑字段（会话级覆盖）；`null` 清掉该字段。
  async setModePatch(
    sessionId: SessionId,
    patch: ModePatch,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) return undefined;
    const next: Record<string, unknown> = { ...this.modeOverrides.get(agent) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) Reflect.deleteProperty(next, key);
      else next[key] = value;
    }
    this.modeOverrides.set(agent, next as unknown as ModeSession);
    const modeId = this.resolveModeId(agent);
    this.record(agent);
    this.installs.get(agent)?.dispose();
    this.installs.delete(agent);
    this.installFor(agent, modeId);
    return this.activeState(sessionId);
  }

  // 改这个会话的三个注入开关：立刻重装这一份（工具面与注入面同时换），返回新的生效态。
  async setSwitches(
    sessionId: SessionId,
    patch: SwitchPatch,
  ): Promise<SessionModeActiveState | undefined> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) return undefined;
    return this.setModePatch(sessionId, patch as ModePatch);
  }

  // 把当前会话的开关覆盖写回这个模式的配置（profile 的那份 patch）：对新会话生效。
  async saveAsDefault(sessionId: SessionId): Promise<SessionModeActiveState | undefined> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) throw new Error("会话不存在。");
    const overrides = this.modeOverrides.get(agent);
    if (overrides === undefined) return;
    const modeId = this.modeOf(agent.session);
    // 写回的是**当下生效**的那一份：模式的 persona/开关 + 逐条目的三态（合并成名单）。
    const editable = this.editableFaceOf(this.definitionFor(agent, modeId));
    const next = plainMode({ ...this.config.modes[modeId], ...editable });
    (this.config.modes as Record<string, SessionMode>)[modeId] = next as unknown as SessionMode;
    await writeMode(modeId, next);
    // 写回后清掉会话覆盖：`config` 已在上面更新，重装用的是新默认，面板与工具面都不会回退。
    this.modeOverrides.delete(agent);
    this.installs.get(agent)?.dispose();
    this.installs.delete(agent);
    this.installFor(agent, modeId);
    return this.activeState(sessionId);
  }

  // 以当前会话的生效配置另存为一个新模式；返回新 id。
  async saveAsNewMode(sessionId: SessionId, code: string, name?: string): Promise<string> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) throw new Error("会话不存在。");
    const id = code.trim();
    if (id.length === 0) throw new Error("模式 code 不能为空。");
    if (!/^[a-zA-Z0-9_-]+$/u.test(id))
      throw new Error("模式 code 只能包含字母、数字、下划线与连字符。");
    if (this.config.modes[id] !== undefined) throw new Error(`模式 ${id} 已存在。`);
    const merged = this.definitionFor(agent, this.resolveModeId(agent));
    const next = plainMode({ ...merged, name: name?.trim() || id });
    // 先落内存再写文件：当前进程立刻可用，不必等 Loader（cordis 只是默认模板，不再参与写回）。
    (this.config.modes as Record<string, SessionMode>)[id] = next as unknown as SessionMode;
    await writeMode(id, next);
    return id;
  }

  // 删除一个"另存为"出来的模式；内置模式拒绝。会话回到部署默认。
  async deleteMode(sessionId: SessionId): Promise<string> {
    const agent = this.ctx.agents.get(sessionId);
    if (agent === undefined) throw new Error("会话不存在。");
    const modeId = this.modeOf(agent.session);
    if (modeId === this.defaultId) throw new Error("部署默认模式不能删除。");
    const remaining = Object.keys(this.config.modes).filter((id) => id !== modeId);
    if (remaining.length === 0) throw new Error("至少要留一个模式。");
    const fallback = this.defaultId === modeId ? (remaining[0] as string) : this.defaultId;
    Reflect.deleteProperty(this.config.modes as Record<string, SessionMode>, modeId);
    await removeMode(modeId);
    this.modeOverrides.delete(agent);
    if (this.projectionHandle.stateOf(agent.session) === modeId) {
      agent.session.append("session-mode/selected", { sessionMode: fallback });
    }
    this.installs.get(agent)?.dispose();
    this.installFor(agent, fallback);
    return fallback;
  }

  // 某个会话**当下生效**的一份：工具是运行期实际可见的集合（按需加载的 MCP 组加载后才会出现），
  // 技能与 policy 是名单合成后的结果。侧边栏面板读它，不读配置清单。
  async activeState(sessionId: SessionId): Promise<SessionModeActiveState | undefined> {
    const session = this.ctx.sessions.get(sessionId);
    if (session === undefined) return undefined;
    const agent = this.ctx.agents.get(sessionId);
    const id = this.modeOf(session);
    const mode = agent === undefined ? this.definition(id) : this.definitionFor(agent, id);
    // `ctx.get` 给的是追踪代理：带 JS 私有字段的方法在代理上会抛，先解包成真服务。
    const unwrap = <T>(value: T | undefined): T | undefined =>
      value === undefined
        ? undefined
        : (((value as { [key: symbol]: unknown })[Symbol.for("cordis.original")] ?? value) as T);
    const tools = unwrap(
      this.ctx.get("tools") as unknown as
        | {
            schemas(agent: Agent): readonly { name: string }[];
            definitions(): readonly { name: string; description?: string }[];
          }
        | undefined,
    );
    const skills = unwrap(
      this.ctx.get("skills") as unknown as
        | {
            list(options?: {
              scope?: Agent;
              cwd?: string;
            }): Promise<readonly { name: string; description: string }[]>;
          }
        | undefined,
    );
    // 技能面按 agent 收口与工作目录扫描：不传 scope 只读全局层，本部署会读成空。
    const cwd = (agent?.session.header as { cwd?: unknown } | undefined)?.cwd;
    const registered =
      skills === undefined
        ? []
        : await skills
            .list({
              ...(agent === undefined ? {} : { scope: agent }),
              ...(typeof cwd === "string" ? { cwd } : {}),
            })
            .catch((error: unknown) => {
              this.ctx.logger.warn("session-mode: skills.list() failed %o", {
                error: String(error),
              });
              return [];
            });
    const config = asModeConfig(this.definition(id), this.definition(id).skills ?? true);
    const override = agent === undefined ? undefined : this.modeOverrides.get(agent);
    // 会话覆盖是整份 `ModeConfig`：面板要按字段显示来源，得知道**哪些字段真的不同**。
    const overriddenFields =
      override === undefined
        ? []
        : (
            [
              ["persona", "persona"],
              ["instructions", "instructions"],
              ["skills", "skills"],
              ["runtimeContext", "runtimeContext"],
              ["allowTools", "allowTools"],
              ["denyTools", "denyTools"],
              ["allowSkills", "allowSkills"],
              ["denySkills", "denySkills"],
              ["allowPolicies", "allowPolicies"],
              ["denyPolicies", "denyPolicies"],
            ] as const
          )
            .filter(([key]) => JSON.stringify(override[key]) !== JSON.stringify(config[key]))
            .map(([, field]) => field);
    return {
      mode: { id, name: mode.name, description: mode.description },
      config,
      session: override,
      overriddenFields,
      // 可删的判据：不是部署默认、且删完还留得下至少一个模式（内置模式有确认弹窗兜底）。
      deletable: id !== this.defaultId && Object.keys(this.config.modes).length > 1,
      catalog: this.buildCatalog(
        agent,
        this.definition(id),
        mode,
        registered,
        tools === undefined
          ? []
          : [...tools.definitions(), ...(agent === undefined ? [] : tools.schemas(agent))],
      ),
    };
  }

  // 这条 policy 规则在**这次调用**里还生效吗（`true` = 交给上游，`false` = 被这个模式禁用）。
  // 判据只有一处：`actor.agent` → `agent.session` → `modeOf`。认不出 agent（没有 agent 的直接调用）、或模式 id 在
  // config 里找不到（重挂前后的瞬间）时一律按"没配"读——拦截路径绝不抛错。
  private policyInForce(policy: PolicyName, actor: object | undefined): boolean {
    const agent = (actor as { readonly agent?: Agent } | undefined)?.agent;
    if (agent === undefined) return true;
    const mode = this.config.modes[this.modeOf(agent.session)];
    if (mode === undefined) return true;
    // 合成规则（deny 优先）：生效集合 =（`allowPolicies` 空 ? 全部 : `allowPolicies`）− `denyPolicies`。
    if (mode.denyPolicies.includes(policy)) return false;
    return mode.allowPolicies.length === 0 || mode.allowPolicies.includes(policy);
  }

  // 一条 policy 规则的裁决：规则生效就原样交给上游（`next()` 的返回值或拒绝照旧出去）；被禁用就**先让上游算完
  // 再丢掉结论**——上游在链首之后独占决策槽，"放过"唯一可能的形态就是无条件裁决（`fs/edit-intent` 上它是免
  // "先读后改"，`fs/write-intent` 上是连陈旧版本 / CAS 那层安全网一起丢）。上游抛出的拒绝也属于这条裁决：
  // 接住它，返回 `undefined`（= 这次调用按"没有这条规则"继续）。
  private async decidePolicy<T>(
    policy: PolicyName,
    actor: object | undefined,
    next: () => T | Promise<T>,
  ): Promise<T | undefined> {
    if (this.policyInForce(policy, actor)) return await next();
    try {
      await next();
    } catch {
      // 上游的拒绝是这次裁决的一部分：禁用就是连它一起不要。
    }
    return undefined;
  }

  // 把某个空白会话（必须还没开过 turn）切到某个模式：先按模式的白名单把 agent preset 落到位（当前那份已经在
  // 名单里就不换——换 preset 是一次重挂；不在名单里就换成名单里的第一个），再落会话事实并重装该 agent 的扩展。
  async select(sessionId: SessionId, mode: string): Promise<string> {
    const definition = this.definition(mode);
    if (!definition.role.includes("main")) {
      throw new Error(`模式 ${JSON.stringify(mode)} 不是用户可选的（它的 role 里没有 main）。`);
    }
    const session = this.ctx.sessions.get(sessionId);
    if (session === undefined) throw new Error(`未知的会话 ${sessionId}`);
    // 空白窗口的判据只有一处：`sessionModeEditableProjection`（client chip 读同一个投影）。
    if (this.editableHandle.stateOf(session) === false) {
      throw new Error("这个会话已经开始，模式不能再改；要换模式请新开一个会话。");
    }
    const agent = this.ctx.agents.get(sessionId);
    const registry = this.presetRegistry();
    if (agent !== undefined && registry !== undefined) {
      const target = this.presetTarget(
        definition.presetsOnly ?? [],
        this.presetOfAgent(registry, agent),
      );
      if (target !== undefined) {
        // 官方那条路自己也会查空白窗口（`agent-preset/locked`）；它切完会 emit `agent-preset/selected`，
        // 监听据此落事实并重装——所以这里先比一次投影，同一个值不写第二条。
        await registry.select(agent, target);
      }
    }
    if (this.projectionHandle.stateOf(session) !== mode) {
      session.append("session-mode/selected", { sessionMode: mode });
    }
    // 会话可能已经建好了 agent（空白会话也有）：立刻按新模式重新应用一遍（与监听那次重复也无妨，幂等）。
    if (agent !== undefined) this.installFor(agent);
    return mode;
  }

  // 把当前挂着的 preset 落进模式的白名单：已经在名单里就返回 `undefined`（不换）；不在里面（或读不到当前那份）
  // 就返回名单的**第一个**（`undefined` = 名单为空 = 不限制，什么都不换）。
  private presetTarget(
    allowed: readonly string[],
    current: string | undefined,
  ): string | undefined {
    if (allowed.length === 0) return undefined;
    // 当前那份在名单里：保持不动（用户自己选的 preset 落在许可范围内，模式不去覆盖它）。
    if (current !== undefined && allowed.includes(current)) return undefined;
    const target = allowed[0];
    return target === current ? undefined : target;
  }

  // 某个 agent 当前挂着的 preset（registry 的 `composedPreset`）；读不到时按"未知"处理（该切就切）。
  private presetOfAgent(registry: Context["agentPresets"], agent: Agent): string | undefined {
    const read = (registry as { composedPreset?: (ctx: Context) => string | undefined })
      .composedPreset;
    if (typeof read !== "function") return undefined;
    try {
      return read.call(registry, agent.ctx);
    } catch {
      return undefined;
    }
  }

  // 官方 preset registry；不在 `inject` 里点名（headless 部署没有它，点名会让本行永不激活），
  // 所以按"可能拿不到"读——`ctx.get` 在当前 ctx 没声明那个服务时会抛。
  private presetRegistry(): Context["agentPresets"] | undefined {
    try {
      return this.ctx.get("agentPresets");
    } catch {
      return undefined;
    }
  }

  // 把某个活着的 agent 切到某个模式（不要求空白会话：子代理创建时的继承走这里）；
  // `options.record: false` 时不写会话日志（只改当前进程）。
  applyTo(agent: Agent, mode: string, options: { record?: boolean } = {}): void {
    this.hydrate(agent);
    // 只有模式真的变了才重装：同一模式重复 `applyTo`（`agent/created` 之后再调一次）不该再装配一遍，
    // 否则每一步会多写一条 `system/message`。覆盖变化由 `hydrate` 自己重装。
    this.definition(mode);
    if (options.record !== false) {
      agent.session.append("session-mode/selected", { sessionMode: mode });
    }
    this.installFor(agent, mode);
  }

  // 该 agent 用哪个模式：会话选过（投影上有）优先，子代理继承父，其余用部署默认。
  // 继承要写进子会话日志——它是一条会话事实，冷恢复与 fork 靠它重建（`modeOf` 只读投影）。
  private resolveModeId(agent: Agent): string {
    // `undefined` = 这个投影没注册（或还没初始化），与"没选过"（`null`）一样落到下一层。
    const selected = this.projectionHandle.stateOf(agent.session);
    if (typeof selected === "string") return selected;
    // 会话级选择归官方 roster；结论落成我们自己的会话事实（`sessionMode`：恢复、子代理继承、
    // 服务端读取都读它）。
    const mapped = this.modeForPreset(this.presetOf(agent.session));
    if (mapped !== undefined) {
      agent.session.append("session-mode/selected", { sessionMode: mapped });
      return mapped;
    }
    const inherited = this.inheritedModeId(agent);
    if (inherited === undefined) return this.defaultId;
    agent.session.append("session-mode/selected", { sessionMode: inherited });
    return inherited;
  }

  // 官方 roster 选定的 preset（没选过、或 registry 没装时为 `undefined`）。
  private presetOf(session: Session): string | undefined {
    // registry 没装（headless 部署）时 header 里没有 preset，读到的就是 `null`：与"没选过"同义。
    const state = this.agentPresetHandle.stateOf(session);
    return typeof state === "string" ? state : undefined;
  }

  // 某个 preset 对应的模式 id——只在映射唯一时回答（只有它一个模式的名单里有这份 preset；没有模式认领、或几个
  // 模式的名单都含它时 `undefined`）；本部署的模式由会话事实决定，这条反查留给"一对一映射"的部署形态。
  modeForPreset(preset: string | undefined): string | undefined {
    if (preset === undefined) return undefined;
    const owners = Object.keys(this.config.modes).filter((id) =>
      (this.config.modes[id]?.presetsOnly ?? []).includes(preset),
    );
    return owners.length === 1 ? owners[0] : undefined;
  }

  // 子代理（有 durable 父会话）继承父当前模式；父不在场、或不是子代理时没有可继承的。
  private inheritedModeId(agent: Agent): string | undefined {
    const parentId = agent.session.header.parentSession;
    if (parentId === undefined) return undefined;
    const parent = this.ctx.agents.get(parentId);
    return parent === undefined ? undefined : this.modeOf(parent.session);
  }

  // 装或换该 agent 的那一份（幂等：同一模式不重复注册）。
  private installFor(agent: Agent, modeId: string = this.resolveModeId(agent)): void {
    const installed = this.installs.get(agent);
    if (installed?.mode === modeId) return;
    installed?.dispose();
    const mode = this.definitionFor(agent, modeId);
    // persona 与默认模型兜底同样落在 `agent.ctx` 上：收回账挂在本行 + agent 两处（见 `./per-agent.ts`），
    // 否则行重挂之后新实例会撞上 `deployment:persona-prefix` 那条 section。
    const account = this.scope.account(agent);
    account.add(installPersona(agent, mode.persona));
    account.add(this.installDefaultModel(agent, modeId));
    this.installs.set(agent, { mode: modeId, dispose: () => account.release() });
    // 收口要的那几项按模式定义整份推过去：`name` / 两份工具名单 / 两份技能名单 / 三个开关。`skills` 缺省时在这里
    // 按这份定义自己的工具名单推导（见 `derivedSkills`）——收口那一侧只认解析后的布尔。
    this.scope.apply(agent, {
      name: mode.name,
      allowTools: mode.allowTools,
      denyTools: mode.denyTools,
      allowToolsOverride: [],
      denyToolsOverride: [],
      allowSkills: mode.allowSkills,
      denySkills: mode.denySkills,
      instructions: mode.instructions,
      skills: mode.skills ?? derivedSkills(mode),
      runtimeContext: mode.runtimeContext,
      dropSections: mode.dropSections ?? [],
    });
  }

  // 模式的默认模型兜底：只在会话尚无任何模型事实（没选过模型、也没落过 request header）时接管这一请求的
  // 路由。它是配置事实、不写会话事件，读构造时的模式快照（设置页保存会让这一行重挂）。
  //
  // `agent/request` 已被上游标为 deprecated（"Retained for existing listeners; do not add new listeners"，且明说
  // 其他 per-request 控制**没有替代 API**）。这里是这个产品行为唯一的接缝：`agent.model.select()` 会写
  // `model/selection` 事件，把"配置默认"变成"用户选择"，直接破坏"只在没有模型事实时兜底"的语义
  // （见 `../.agents/adrs/20260925-默认模型住在模式定义里.md`）。债见
  // `.agents/debts/20261026-默认模型兜底依赖deprecated的agent-request.md`。
  private installDefaultModel(agent: Agent, modeId: string): () => void {
    return agent.ctx.on("agent/request", async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next();
      const model = this.config.modes[modeId]?.defaultModel;
      if (model === undefined) return resolved;
      // 上游 session-controller 没装（headless）时这个投影不存在，按"没有选择"处理。
      const pending = this.modelSelectionHandle.stateOf(agent.session).pending;
      if (pending !== undefined && pending !== null) return resolved;
      if (agent.session.requestHeader() !== undefined) return resolved;
      return {
        ...resolved,
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
      };
    });
  }
}

export async function apply(ctx: Context, config: ResolvedConfig): Promise<void> {
  const modes = await SessionModes.create(ctx, config);
  registerHttpRoutes(ctx, modes);
  // 配置页的工具 / 技能候选：一条本包自己开的 Remote 面（客户端半自己 mount，见 `./catalog-remote.ts`）。
  ctx.plugin(SessionModeCatalog);
}

interface HttpRequestLike {
  method?: string;
  url?: string;
  on(event: "data", listener: (chunk: Uint8Array | string) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: unknown) => void): this;
}

interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(body?: string): void;
}

interface HttpServerLike {
  register(route: {
    kind: "exact";
    path: string;
    handler: (request: HttpRequestLike, response: HttpResponseLike) => void | Promise<void>;
  }): () => void;
}

function respondJson(response: HttpResponseLike, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function requestJson(request: HttpRequestLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    request.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    });
    request.on("end", () => {
      try {
        resolve(chunks.length === 0 ? undefined : (JSON.parse(chunks.join("")) as unknown));
      } catch {
        reject(new TypeError("请求体不是合法 JSON。"));
      }
    });
    request.on("error", reject);
  });
}

function queryValue(url: string | undefined, name: string): string | undefined {
  if (url === undefined) return undefined;
  const separator = url.indexOf("?");
  if (separator < 0) return undefined;
  const value = new URLSearchParams(url.slice(separator + 1)).get(name);
  return value === null || value.length === 0 ? undefined : value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} 必须是非空字符串。`);
  }
  return value;
}

// 一条 POST 是面板的写面还是"切换模式"：键漏一个，请求就会掉到 `mode` 校验上，报"mode 必须是非空字符串"。
export function isWriteRequest(record: Record<string, unknown>): boolean {
  return (
    typeof record["switches"] === "object" ||
    typeof record["modePatch"] === "object" ||
    typeof record["itemState"] === "object" ||
    typeof record["applyConfig"] === "object" ||
    typeof record["saveConfig"] === "object" ||
    (typeof record["saveAsNewMode"] === "object" && record["saveAsNewMode"] !== null) ||
    record["deleteMode"] === true ||
    record["saveAsDefault"] === true
  );
}

async function handleRoute(
  modes: SessionModes,
  request: HttpRequestLike,
  response: HttpResponseLike,
): Promise<void> {
  try {
    if (request.method === "GET") {
      // 带 `sessionId` 时给这个会话的生效态，否则是模式清单（页面与 composer chip 用后者）。
      const sessionId = queryValue(request.url, "sessionId");
      if (sessionId === undefined) {
        respondJson(response, 200, modes.roster());
        return;
      }
      const active = await modes.activeState(sessionId as SessionId);
      if (active === undefined) {
        respondJson(response, 404, { error: "会话不存在。" });
        return;
      }
      respondJson(response, 200, active);
      return;
    }
    if (request.method === "POST") {
      const body = await requestJson(request);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new TypeError("请求体必须是 JSON 对象。");
      }
      const record = body as Record<string, unknown>;
      // 面板的写面：`switches` 改这个会话的开关，`saveAsDefault` 把当前覆盖写回模式配置。
      if (isWriteRequest(record)) {
        const target = requiredString(record["sessionId"], "sessionId") as SessionId;
        const saved =
          record["saveAsDefault"] === true ? await modes.saveAsDefault(target) : undefined;
        if (saved !== undefined) {
          respondJson(response, 200, saved);
          return;
        }
        if (record["deleteMode"] === true) {
          await modes.deleteMode(target);
          const state = await modes.activeState(target);
          respondJson(
            response,
            state === undefined ? 404 : 200,
            state ?? { error: "会话不存在。" },
          );
          return;
        }
        const saving = record["saveAsNewMode"];
        if (typeof saving === "object" && saving !== null) {
          const value = saving as { code?: unknown; name?: unknown };
          await modes.saveAsNewMode(
            target,
            requiredString(value.code, "code"),
            typeof value.name === "string" ? value.name : undefined,
          );
        }
        if (typeof record["saveConfig"] === "object" && record["saveConfig"] !== null) {
          const draft = record["saveConfig"] as { config?: ModeConfig };
          if (draft.config === undefined) {
            respondJson(response, 400, { error: "saveConfig 需要完整的 config。" });
            return;
          }
          const state = await modes.saveConfig(target, draft.config);
          respondJson(
            response,
            state === undefined ? 404 : 200,
            state ?? { error: "会话不存在。" },
          );
          return;
        }
        if (typeof record["applyConfig"] === "object" && record["applyConfig"] !== null) {
          const draft = record["applyConfig"] as { config?: ModeConfig };
          if (draft.config === undefined) {
            respondJson(response, 400, { error: "applyConfig 需要完整的 config。" });
            return;
          }
          const state = await modes.applyConfig(target, draft.config);
          respondJson(
            response,
            state === undefined ? 404 : 200,
            state ?? { error: "会话不存在。" },
          );
          return;
        }
        const patch = record["modePatch"] ?? record["switches"];
        const state =
          typeof patch === "object" && patch !== null
            ? await modes.setModePatch(target, patch as ModePatch)
            : await modes.activeState(target);
        if (state === undefined) {
          respondJson(response, 404, { error: "会话不存在。" });
          return;
        }
        respondJson(response, 200, state);
        return;
      }
      const sessionId = requiredString(record["sessionId"], "sessionId") as SessionId;
      const mode = requiredString(record["mode"], "mode");
      const result: SessionModeSelectResult = { mode: await modes.select(sessionId, mode) };
      respondJson(response, 200, result);
      return;
    }
    response.writeHead(405);
    response.end();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    respondJson(response, error instanceof TypeError ? 400 : 409, { error: message });
  }
}

// 把清单与切换挂到宿主路由表上。`webServer` 必须等：它可能比本行晚激活，一次性 `ctx.get` 取不到就不会
// 再试（后果是请求落到静态资源 fallback）。
function registerHttpRoutes(ctx: Context, modes: SessionModes): void {
  ctx.inject(["webServer"], (scope) => {
    // webServer 的类型由上游 `@deepseek-ai/dsh-host-webserver` 声明；这里只按用到的 register 面做结构转换。
    const webServer = scope.get("webServer") as unknown as HttpServerLike | undefined;
    if (webServer === undefined) return;
    scope.effect(
      () =>
        webServer.register({
          kind: "exact",
          path: SESSION_MODE_PATH,
          handler: (request, response) => handleRoute(modes, request, response),
        }),
      "session-mode: HTTP route",
    );
  });
}
