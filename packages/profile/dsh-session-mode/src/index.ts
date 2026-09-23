/**
 * 会话模式的 host 半：模式清单（config 里的纯数据）、会话 ↔ 模式的选择、按会话应用 persona 与收口。
 *
 * **模式不是 Cordis 子树**。旧的 `@morlay/dsh-agent-preset` 每个模式都是一行
 * `@deepseek-ai/dsh-agent-preset`，`config.plugins` 里装 persona 与 scope 行，靠 preset scope 的父链
 * 对会话生效——代价是整个官方 registry（声明式行、每 revision 一棵 Loader 子树、`isolate` realm）都在
 * 部署里。这里只留两件事：模式是一份数据，应用落在会话自己的 scope 上：
 *
 * | 事实             | 落在哪                                                                                     |
 * | ---------------- | ------------------------------------------------------------------------------------------ |
 * | 模式清单与默认值 | 本行的 `config`（装配层可整体改写；`modes.ts` 给形状与校验）                                |
 * | 会话当前模式     | session 事件 `session-mode/selected` + 投影 `sessionMode`（log-only，重建读投影）           |
 * | 提示词           | `persona`：把模式的 persona 注册到该 agent 的 scope（`persona.ts`）                         |
 * | 工具与注入开关   | 推给 `ctx.sessionToolScope`（`@morlay/dsh-context-assembler/scope`，行 id `context-assembler-scope`） |
 * | 页面上的选择面   | HTTP 路由 `GET/POST /session-mode`（清单与切换）+ 会话投影（当前值）                        |
 *
 * 应用时机是 `agent/created`：它早于任何一次提示词装配（装配发生在 turn 里），所以 persona 一定在该会话
 * 第一次装配之前就注册好了。模式在**空白会话**里可以切换，切换时对着已有的 agent 重新应用一遍。
 *
 * 切换只允许在空白窗口（还没开过 turn）：会话的历史是在某个模式的工具集与提示词下产生的，换了模式，那段
 * 历史就与实际装配对不上——与上游 `agentPresets.select` 的判据一致，也用同一个投影（`turnBoundary`）。
 */

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
import type { SessionToolScope } from "@morlay/dsh-context-assembler/scope";
import { z } from "zod";
import { Config, configProblem, type SessionMode, type SessionModeRole } from "./modes.ts";
import { installPersona } from "./persona.ts";
import {
  SESSION_MODE_PATH,
  type SessionModeRoster,
  type SessionModeRow,
  type SessionModeSelectResult,
} from "./shared.ts";

/** Cordis 插件名：与行 id 一致。 */
export const name = "session-mode";

/**
 * 依赖：投影服务（登记 `sessionMode`、读 `turnBoundary`）、读会话与 agent 的两个注册表，以及提示词注册表
 * （persona 的 section 注册在它上面）。
 *
 * 这些名字必须在 `inject` 里点名：cordis 的**属性访问**（`this.ctx.sessions`）要求本 fiber 声明过那个服务，
 * 未声明会抛 `cannot get property "sessions" without inject`（`ctx.get(name)` 才不需要声明）。
 */
export const inject = ["agents", "sessions", "sessionProjections", "systemPrompt"];

export { Config } from "./modes.ts";
export type {
  SessionMode,
  SessionModeModel,
  SessionModePersona,
  SessionModeRole,
} from "./modes.ts";
export { SESSION_MODE_PATH } from "./shared.ts";
export type { SessionModeRoster, SessionModeRow } from "./shared.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessionModes: SessionModes;
  }
}

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    /**
     * 会话在空白窗口里换了模式。**log-only**：它记录此后每一步实际运行的模式，恢复与 fork 时据此重建
     * （模式决定模型看到的工具与提示词，所以它必须进日志）。
     */
    "session-mode/selected": { sessionMode: string };
  }
}

declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionStateMap {
    sessionMode: string | null;
  }
  interface SessionProjectionMap {
    /** 会话当前模式；`null` 表示没选过（用部署默认）。 */
    sessionMode: string | null;
  }
}

const sessionModeSchema: z.ZodType<string | null> = z.union([z.string(), z.null()]);

/** 会话模式的投影：初值来自空日志（没选过就是 `null`），只被选择事件推进。 */
export const sessionModeProjection = {
  key: "sessionMode",
  stateSchema: sessionModeSchema,
  init: () => null,
  apply: (state: string | null, event: SessionEvent) =>
    event.type === "session-mode/selected" ? event.data.sessionMode : state,
  wire: { viewSchema: sessionModeSchema, view: (state: string | null) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<"sessionMode", string | null>;

/** 模式清单、默认模式、按会话读取与切换。 */
export class SessionModes extends Service {
  /** 每个 agent 已经装上的那一份（persona + 默认模型兜底；模式变了就换一份）。 */
  private readonly installs = new WeakMap<Agent, { mode: string; dispose: () => void }>();

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "sessionModes");
    const problem = configProblem(config);
    if (problem !== undefined) throw new Error(problem);
    ctx.sessionProjections.register(sessionModeProjection);
    // 会话一建立就装上：这早于它的第一次装配，persona 因此一定在装配之前注册好。
    ctx.on("agent/created", ({ agent }) => {
      this.installFor(agent);
    });
  }

  /** 新会话用它：config 里的 `default`。 */
  get defaultId(): string {
    return this.config.default;
  }

  /** 选择器要的清单：只列 `main` 角色的模式（id、展示名、说明，顺序即 config 里 `modes` 的插入序）。 */
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

  /**
   * 声明了某个角色的模式 id（顺序即 config 的插入序）：`main` 给用户选择器，`subagent` 给子代理候选。
   * @param role - 目标角色。
   * @returns 该角色下的模式 id。
   */
  idsFor(role: SessionModeRole): string[] {
    return Object.entries(this.config.modes)
      .filter(([, mode]) => mode.role.includes(role))
      .map(([id]) => id);
  }

  /**
   * 同 {@link idsFor}，给的是定义——"指定 mode" 那条接缝要拿候选集。
   * @param role - 目标角色。
   * @returns 该角色下的模式与其定义。
   */
  modesFor(role: SessionModeRole): { id: string; mode: SessionMode }[] {
    return this.idsFor(role).map((id) => ({ id, mode: this.definition(id) }));
  }

  /** 页面用的清单 + 默认模式。 */
  roster(): SessionModeRoster {
    return { default: this.defaultId, modes: this.list() };
  }

  /** 按 id 取定义；未知 id 直接抛（切换路径上它就是用户的错）。 */
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

  /** 会话当前模式：投影上有就用它，否则是部署默认。 */
  modeOf(session: Session): string {
    const selected = this.ctx.sessionProjections.stateOf(session, "sessionMode");
    return selected ?? this.defaultId;
  }

  /** 会话当前模式的定义。 */
  modeOfSession(session: Session): SessionMode {
    return this.definition(this.modeOf(session));
  }

  /**
   * 把某个空白会话切到某个模式。
   * @param sessionId - 目标会话（必须还没有开过 turn）。
   * @param mode - 目标模式 id。
   * @returns 提交后的模式 id。
   */
  async select(sessionId: SessionId, mode: string): Promise<string> {
    const definition = this.definition(mode);
    if (!definition.role.includes("main")) {
      throw new Error(`模式 ${JSON.stringify(mode)} 不是用户可选的（它的 role 里没有 main）。`);
    }
    const session = this.ctx.sessions.get(sessionId);
    if (session === undefined) throw new Error(`未知的会话 ${sessionId}`);
    const boundary = this.ctx.sessionProjections.stateOf(session, "turnBoundary");
    if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
      throw new Error("这个会话已经开始，模式不能再改；要换模式请新开一个会话。");
    }
    session.append("session-mode/selected", { sessionMode: mode });
    // 会话可能已经建好了 agent（空白会话也有）：立刻按新模式重新应用一遍。
    const agent = this.ctx.agents.get(sessionId);
    if (agent !== undefined) this.installFor(agent);
    return mode;
  }

  /**
   * 把某个活着的 agent 切到某个模式。与 {@link select} 的差别：它不要求空白会话——子代理创建时的继承
   * 走这里，**未来的"指定 mode"入口（模型侧或配置侧）也走这里**（那条接缝还没做）。
   * @param agent - 目标 agent。
   * @param mode - 目标模式 id。
   * @param options.record - 是否把这次切换写进会话日志（缺省写；只想改当前进程时给 `false`）。
   */
  applyTo(agent: Agent, mode: string, options: { record?: boolean } = {}): void {
    this.definition(mode);
    if (options.record !== false) {
      agent.session.append("session-mode/selected", { sessionMode: mode });
    }
    this.installFor(agent, mode);
  }

  /**
   * 该 agent 用哪个模式：会话选过（投影上有）优先，子代理继承父，其余用部署默认。
   *
   * 继承要**写进子会话日志**：它是一条会话事实，冷恢复与 fork 都要靠它重建（{@link modeOf} 只读投影）。
   */
  private resolveModeId(agent: Agent): string {
    // `undefined` = 这个投影没注册（或还没初始化），与"没选过"（`null`）一样落到默认。
    const selected = this.ctx.sessionProjections.stateOf(agent.session, "sessionMode");
    if (typeof selected === "string") return selected;
    const inherited = this.inheritedModeId(agent);
    if (inherited === undefined) return this.defaultId;
    agent.session.append("session-mode/selected", { sessionMode: inherited });
    return inherited;
  }

  /** 子代理（有 durable 父会话）继承父当前模式；父不在场、或不是子代理时没有可继承的。 */
  private inheritedModeId(agent: Agent): string | undefined {
    const parentId = agent.session.header.parentSession;
    if (parentId === undefined) return undefined;
    const parent = this.ctx.agents.get(parentId);
    return parent === undefined ? undefined : this.modeOf(parent.session);
  }

  /** 装或换该 agent 的那一份（幂等：同一模式不重复注册）。 */
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
    this.toolScope()?.apply(agent, mode);
  }

  /**
   * 模式的 `defaultModel` 兜底：只在会话**尚无任何模型事实**（没选过模型、也还没跑过请求）时接管这一
   * 请求的路由；一旦用户选过（投影 `pending`）或会话已经落过 header，就不再插手。
   *
   * 它是**配置事实**，不写会话事件——重启后仍由 config 决定；设置页里那条会话级选择才是会话事实。
   */
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

  /** 收口服务由 `@morlay/dsh-context-assembler/scope` 那一行发布；没装它就只有 persona。 */
  private toolScope(): SessionToolScope | undefined {
    try {
      return this.ctx.get("sessionToolScope");
    } catch {
      return undefined;
    }
  }
}

export function apply(ctx: Context, config: Config): void {
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

/**
 * 把清单与切换挂到同一张宿主路由表上。
 *
 * `webServer` **必须等**：它可能比本行晚激活，而一次性 `ctx.get` 取到 `undefined` 之后不会再试一次——
 * 路由没注册的后果是请求落到静态资源 fallback，非 GET/HEAD 一律 405。
 */
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
