// 会话模式的 host 半：模式清单（config 里的纯数据）、会话 ↔ 模式的选择、按会话应用 persona 与**收口**。模式是一份
// 数据，应用落在会话自己的 scope 上（persona + 工具收口与三个注入开关，见 `./scope.ts`），默认模型住在
// `modes.<id>.defaultModel`；换模式只允许在空白窗口。取舍见 `.agents/designs/20260924-会话模式.md`。

import { Service, type Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
// 会话级模型事实（投影 `modelSelection` 与事件 `model/selection`）由上游 session-controller 声明；
// 那一行可能没装（headless 部署），所以读它时按"可能为空"处理。
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { ReasoningEffortId, type LlmCallConfig } from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
import type {} from "@deepseek-ai/dsh-session-projection";
// Type-only：官方 roster 的会话投影（`agentPreset`）与它的选择事件——选择面归官方 preset，
// 我们读它的选择、落成自己的会话事实。
import type {} from "@deepseek-ai/dsh-agent-preset-registry";
// Type-only：上游 fs 的 policy 事件词汇（`fs/write-intent` / `fs/edit-intent` 的签名与 `FsWriteIntent`）。
import type {} from "@deepseek-ai/dsh-fs";
import { z } from "zod";
import {
  configProblem,
  derivedSkills,
  type ResolvedConfig,
  type SessionMode,
  type SessionModeRole,
} from "./modes.ts";
import { installPersona } from "./persona.ts";
import { SessionScope } from "./scope.ts";
import {
  SESSION_MODE_PATH,
  type PolicyName,
  type SessionModeRoster,
  type SessionModeRow,
  type SessionModeSelectResult,
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
export { POLICY_NAMES } from "./shared.ts";
export type { PolicyName, SessionModeRoster, SessionModeRow } from "./shared.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessionModes: SessionModes;
  }
}

declare module "@deepseek-ai/dsh-session/types" {
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

  // 按会话收口：工具名单、instruction / 技能目录 / 动态快照三个开关。它由本行**内部持有**（不发布服务）——收口的
  // 输入就是模式定义、唯一消费者也是模式。
  private readonly scope: SessionScope;

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
      modes: structuredClone(config.modes.get()) as Record<string, SessionMode>,
    };
    // 退役的顶层 `models` 还配着值就让装配期报错。
    const problem = configProblem({ ...this.config, models: config.models });
    if (problem !== undefined) throw new Error(problem);
    this.scope = new SessionScope(ctx);
    ctx.sessionProjections.register(sessionModeProjection);
    ctx.sessionProjections.register(sessionModeEditableProjection);
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
      if (this.ctx.sessionProjections.stateOf(agent.session, "sessionMode") !== mapped) {
        agent.session.append("session-mode/selected", { sessionMode: mapped });
      }
      this.installFor(agent, mapped);
    });
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

  // 会话当前模式：投影上有就用它，否则是部署默认。
  modeOf(session: Session): string {
    const selected = this.ctx.sessionProjections.stateOf(session, "sessionMode");
    return selected ?? this.defaultId;
  }

  // 会话当前模式的定义。
  modeOfSession(session: Session): SessionMode {
    return this.definition(this.modeOf(session));
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

  // 把某个空白会话（必须还没开过 turn）切到某个模式：先把 agent preset 换成模式声明的那个
  // （目标与当前相同时不切——换 preset 是一次重挂），再落会话事实并重装该 agent 的扩展。
  async select(sessionId: SessionId, mode: string): Promise<string> {
    const definition = this.definition(mode);
    if (!definition.role.includes("main")) {
      throw new Error(`模式 ${JSON.stringify(mode)} 不是用户可选的（它的 role 里没有 main）。`);
    }
    const session = this.ctx.sessions.get(sessionId);
    if (session === undefined) throw new Error(`未知的会话 ${sessionId}`);
    // 空白窗口的判据只有一处：`sessionModeEditableProjection`（client chip 读同一个投影）。
    if (this.ctx.sessionProjections.stateOf(session, "sessionModeEditable") === false) {
      throw new Error("这个会话已经开始，模式不能再改；要换模式请新开一个会话。");
    }
    const agent = this.ctx.agents.get(sessionId);
    const registry = this.presetRegistry();
    if (agent !== undefined && registry !== undefined && definition.preset.length > 0) {
      // 官方那条路自己也会查空白窗口（`agent-preset/locked`）；它切完会 emit `agent-preset/selected`，
      // 监听据此落事实并重装——所以这里先比一次投影，同一个值不写第二条。
      if (this.presetOfAgent(registry, agent) !== definition.preset) {
        await registry.select(agent, definition.preset);
      }
    }
    if (this.ctx.sessionProjections.stateOf(session, "sessionMode") !== mode) {
      session.append("session-mode/selected", { sessionMode: mode });
    }
    // 会话可能已经建好了 agent（空白会话也有）：立刻按新模式重新应用一遍（与监听那次重复也无妨，幂等）。
    if (agent !== undefined) this.installFor(agent);
    return mode;
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
    const selected = this.ctx.sessionProjections.stateOf(agent.session, "sessionMode");
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
    try {
      const state = this.ctx.sessionProjections.stateOf(session, "agentPreset");
      return typeof state === "string" ? state : undefined;
    } catch {
      // registry 没装（headless 部署）时这个投影不存在：按"没有选择"处理。
      return undefined;
    }
  }

  // 某个 preset 对应的模式 id——只在映射唯一时回答（共享同一份 preset、或没有模式挂它时 `undefined`）；
  // 本部署的模式由会话事实决定，这条反查留给"一对一映射"的部署形态。
  modeForPreset(preset: string | undefined): string | undefined {
    if (preset === undefined) return undefined;
    const owners = Object.keys(this.config.modes).filter(
      (id) => this.config.modes[id]?.preset === preset,
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
    const mode = this.definition(modeId);
    const disposers = [
      installPersona(agent, mode.persona),
      this.installDefaultModel(agent, modeId),
    ];
    this.installs.set(agent, {
      mode: modeId,
      dispose: () => {
        for (const dispose of disposers) dispose();
      },
    });
    // 收口要的那几项按模式定义整份推过去：`name` / 两份工具名单 / 两份技能名单 / 三个开关。`skills` 缺省时在这里
    // 按这份定义自己的工具名单推导（见 `derivedSkills`）——收口那一侧只认解析后的布尔。
    this.scope.apply(agent, {
      name: mode.name,
      allowTools: mode.allowTools,
      denyTools: mode.denyTools,
      allowSkills: mode.allowSkills,
      denySkills: mode.denySkills,
      instructions: mode.instructions,
      skills: mode.skills ?? derivedSkills(mode),
      runtimeContext: mode.runtimeContext,
    });
  }

  // 模式的默认模型兜底：只在会话尚无任何模型事实（没选过模型、也没落过 request header）时接管这一请求的
  // 路由。它是配置事实、不写会话事件，读构造时的模式快照（设置页保存会让这一行重挂）。
  private installDefaultModel(agent: Agent, modeId: string): () => void {
    return agent.ctx.on("agent/request", async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next();
      const model = this.config.modes[modeId]?.defaultModel;
      if (model === undefined) return resolved;
      // 上游 session-controller 没装（headless）时这个投影不存在，按"没有选择"处理。
      const pending = this.ctx.sessionProjections.stateOf(agent.session, "modelSelection")?.pending;
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

export function apply(ctx: Context, config: ResolvedConfig): void {
  const modes = new SessionModes(ctx, config);
  registerHttpRoutes(ctx, modes);
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} 必须是非空字符串。`);
  }
  return value;
}

async function handleRoute(
  modes: SessionModes,
  request: HttpRequestLike,
  response: HttpResponseLike,
): Promise<void> {
  try {
    if (request.method === "GET") {
      respondJson(response, 200, modes.roster());
      return;
    }
    if (request.method === "POST") {
      const body = await requestJson(request);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new TypeError("请求体必须是 JSON 对象。");
      }
      const record = body as Record<string, unknown>;
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
