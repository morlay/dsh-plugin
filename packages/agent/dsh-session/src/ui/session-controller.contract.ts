// 会话目录契约：令牌按服务语义命名（上游注册名 `sessions`）。
//
// 成员从上游 `ISessions` 接口推导（`list` / `retain` / `using` / …），实现由 `SessionControllerDefault`
// 组合 `ClientSessions` 提供。
import type { Context } from "@morlay/zephyr";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session";

/**
 * 会话作用域：本装配**实际给出**的成员子集。
 *
 * 不冒充上游 `AgentContext`（那是 `Omit<Context, "remote"> & { remote: ClientRemote & … }` 的完整 cordis 面）：
 * 我们的会话作用域是就地造的对象，只有下面这几个成员；冒充上游完整面只能靠一次类型断言，那是谎报。
 */
export interface SessionScope {
  readonly sessionId: SessionId;

  effect(fn: () => unknown): () => void;

  get(name?: string): unknown;

  on(): () => void;

  emit(): void;

  off(): void;

  inject(names: readonly string[], callback?: (scope: unknown) => unknown): unknown;
}

/**
 * 会话视图：本装配给出的最小 `ISession` 子集（其余成员由 Proxy 兜成「明确失败」）。
 *
 * 同上：不冒充上游 `ISession`，只声明真正给出的读面。
 */
export interface SessionView {
  readonly sessionId: string;

  getSnapshot(): unknown;

  subscribe(fn: () => void): () => void;

  readonly projections: { faceOf(): unknown };

  readonly queue: { getSnapshot(): readonly unknown[]; subscribe(fn: () => void): () => void };
}

/**
 * 会话目录快照：本装配**实际给出**的成员子集。
 *
 * 行是 Host 推送/响应原样透传的对象，不冒充上游 `SessionSummary`（必填 `displayTitle` / `blank` /
 * `retainedBy` 等由上游 manager 计算，本装配没有那一层）。`ids` 顺序即 Host 列表顺序；
 * 同一拍快照里每个 id 都有对应的 `byId` 行。
 */
export interface SessionCatalogState {
  readonly ids: readonly string[];

  readonly byId: Readonly<Record<string, unknown>>;

  /** 到达生命周期：`ready` 且 `ids` 为空才是「真的没有会话」。 */
  readonly phase: "loading" | "ready" | "failed";

  /** 投影值与显式读状态（本装配恒为空表：宿主不挂投影面）。 */
  readonly projectionsBySession: Readonly<Record<string, unknown>>;
}

/**
 * 会话目录的只读 observable：`getSnapshot()` 给出不可变快照，`subscribe()` 在每次写回后**同步**回调。
 *
 * 与上游 `ObservableSnapshot` 同形；差别只在快照行的类型（见 `SessionCatalogState`）。
 */
export interface SessionCatalog {
  getSnapshot(): SessionCatalogState;

  subscribe(listener: () => void): () => void;
}

/**
 * 保留句柄：本装配只保证「会话身份 + 释放」。
 *
 * `release()` / `dispose()` 幂等（重复调用只有第一次生效）；调用后本装配不再把这一行算作「被主视图保留」。
 * `binding` / `ready` 是上游 `SessionReference` 的成员，这里如实标成不保证：本装配没有异步打开过程，
 * `ready` 恒已兑现，`binding` 是最小 `SessionView` 那一侧的对象。
 */
export interface SessionRetainHandle {
  readonly sessionId: SessionId;

  readonly binding: unknown;

  readonly ready: Promise<unknown>;

  release(): void;

  dispose(): void;
}

@Injectable()
export abstract class SessionController {
  abstract readonly list: SessionCatalog;

  /** 建一个新会话（`ui-workspace` 的「在某工作区新建会话」走它）。 */
  abstract create(opts?: Parameters<ISessions["create"]>[0]): ReturnType<ISessions["create"]>;

  /** 搜索条数上限（上游 `searchResultLimit`；UI 直接读它）。 */
  abstract readonly searchResultLimit: ISessions["searchResultLimit"];

  /** 一个会话的直系子代理地址（本装配没有子代理：`undefined`）。 */
  abstract subagentAddress(
    id: Parameters<ISessions["subagentAddress"]>[0],
  ): ReturnType<ISessions["subagentAddress"]>;

  /** 全文搜索（本装配没有索引面时回 `{ ok: false }`）。 */
  abstract search(
    query: Parameters<ISessions["search"]>[0],
    signal: Parameters<ISessions["search"]>[1],
  ): ReturnType<ISessions["search"]>;

  /** 从某个会话的前缀分叉（本装配没有分叉面）。 */
  abstract fork(opts: Parameters<ISessions["fork"]>[0]): ReturnType<ISessions["fork"]>;

  /** 重新拉一次 Host 的会话目录。 */
  abstract refresh(): ReturnType<ISessions["refresh"]>;

  /**
   * 从一个 cordis 上下文反查它所属会话。
   *
   * 本装配不铸造 `AgentContext`（会话作用域用 `SessionScope` 那个显式子集），所以恒为 `undefined`。
   */
  abstract scopeOf(ctx: Context): ReturnType<ISessions["scopeOf"]>;

  /** 重新读一个会话的投影（宿主拒绝复用 blank 时，UI 会刷新那一行）。 */
  abstract refreshProjections(sessionId: Parameters<ISessions["refreshProjections"]>[0]): ReturnType<ISessions["refreshProjections"]>;

  /** 一个会话的作用域（`ui-input-trigger` 用它把 sessionId 换成 controller 的 ctx）。 */
  abstract scope(id: Parameters<ISessions["scope"]>[0]): SessionScope | undefined;

  /** 从一个作用域反查会话面（输入区触发器用它）。 */
  abstract sessionOf(ctx: SessionScope): SessionView | undefined;

  /** 取一个会话实例（宿主侧的 `ctx.sessions.get(id)`；客户端侧给空）。 */
  abstract get(id: string): unknown;

  /** 一行的当前 binding（上游 `ui-session` 用它比对保留者）。 */
  abstract binding(id: string): unknown;

  /** 某一行的保留信息（上游 `ui-session` 的 `watchMainRetention` 订阅它）。 */
  abstract retainInfo(id: string): { getSnapshot(): unknown; subscribe(fn: () => void): () => void };

  abstract retain(
    target: Parameters<ISessions["retain"]>[0],
    options: Parameters<ISessions["retain"]>[1],
  ): SessionRetainHandle;

  abstract using<T>(
    target: Parameters<ISessions["using"]>[0],
    options: Parameters<ISessions["using"]>[1],
    operation: (reference: SessionRetainHandle) => T | Promise<T>,
  ): Promise<T>;
}

/**
 * 覆盖守卫：上游 `ISessions` 的每个成员都必须在契约里有对应项，漏一个编译失败。
 *
 * **注意**：守卫按**键**核对，管不到「同名但更窄」——`list` / `retain` / `scope` / `sessionOf` / `binding`
 * 五处仍按本装配实供收窄（`SessionCatalog` / `SessionRetainHandle` / `SessionScope` / `SessionView`），
 * 放宽到上游真类型需要先造出 `SessionSummary` 行、`SessionBinding` 与 `AgentContext`，见审计记录。
 */
export type SessionControllerCovered = AssertTrue<AssertCovered<ISessions, SessionController>>;
