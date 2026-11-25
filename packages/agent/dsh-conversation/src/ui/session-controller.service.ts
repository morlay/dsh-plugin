// sessions 行（浏览器侧）：**组合上游 `ClientSessions`**，与 `workspaces` 行组合 `ClientWorkspaceModel` 同构。
//
// 为什么不自己实现：上游 `ClientSessions` 已经在构造里接好了整套语义——
//   - `create` 成功后写**占位行**（`recordMutation({ kind: 'placeholder', … })`）；
//   - `retain` 按 source 计数，`retainInfo` 暴露 `retainedBy`；
//   - `manager.subscribe` → `projectList()` 把目录投影成 `list` 快照；
//   - dispose 时收敛 scope 与 manager 的静默期。
// 手写这套（本文件的历史）漏一条就是一类 bug，且只能靠"点某个按钮没反应"发现。
import { ClientSessions } from "@deepseek-ai/dsh-api-session-controller/src/client/sessions/service.ts";
import { inject, Injectable, type Context, type OnDispose, type OnInit } from "@morlay/zephyr";
import { CommandRunner } from "@morlay/dsh-command/contract";
import { ClientConnection, Remote } from "@morlay/zephyr-app/client";
import {
  SessionController,
  type SessionCatalogState,
  type SessionRetainHandle,
  type SessionScope,
  type SessionView,
} from "@morlay/dsh-conversation/contract";
import { sessionGroupName } from "@morlay/dsh-session/endpoint";
import { SessionEndpointClient } from "@morlay/dsh-session/ui";
import { LiveSessionRemotes } from "./remote-session.ts";
import { asUpstreamContext } from "./upstream-context.ts";

/** `onInit` 之前的目录快照：空且 `loading`（"还没拉"与"真没有会话"要分得开）。 */
const EMPTY_CATALOG_STATE: SessionCatalogState = {
  ids: [],
  byId: {},
  phase: "loading",
  projectionsBySession: {},
};

/**
 * `onInit` 之前的目录读面：空且 `loading`。
 *
 * 身份**模块级稳定**（`useSyncExternalStore` 的依赖要比得下去重），并且不缓存到实例上。
 */
const EMPTY_CATALOG: SessionController["list"] = {
  getSnapshot: () => EMPTY_CATALOG_STATE,
  subscribe: () => () => {},
};

/** 上游 `session/control` 的帧形状（本行只把它转交给 `ClientSessions.handleControlFrame`）。 */
type ControlFrame = Parameters<ClientSessions["handleControlFrame"]>[0];

/**
 * 上游保留句柄 → 契约句柄。
 *
 * 差别只有一条：上游用 `[Symbol.dispose]()` 释放，契约面声明的是 `dispose()`（两者都幂等）。
 * `binding` 保持**惰性**（上游是 getter，释放后抛）——提前求值会把"释放后读"变成"保留时就炸"。
 * @param reference - 上游 `ClientSessions.retain` 给的句柄。
 * @returns 契约面的句柄。
 */
function retainHandleOf(reference: ReturnType<ClientSessions["retain"]>): SessionRetainHandle {
  return {
    sessionId: reference.sessionId,
    get binding(): unknown {
      return reference.binding;
    },
    ready: reference.ready,
    release: () => reference.release(),
    dispose: () => reference.release(),
  };
}

@Injectable()
export class SessionControllerDefault extends SessionController implements OnInit, OnDispose {
  private readonly remote = inject(Remote);

  /** `session` 组的客户端形态：一元方法与 `control` 流都走它（组名与帧形状的 home 在契约类上）。 */
  private readonly sessionEndpoint = inject(SessionEndpointClient);

  /** `commands.execute` 的真身：我们的命令执行器。 */
  /**
   * 命令执行器：**可选**——只测 `session` 面的装配（如 `sessions-create.spec`）可以不装它。
   * 上游 `commands.execute` 落到这里；没装时那一路报明确的"未挂载"而不是让整个行失败。
   */
  private readonly commandRunner = inject.optional(CommandRunner);

  /** 连接面：**可选**——只测数据面的装配没有它，按单代跑（上游流生命周期的重连因此不触发）。 */
  private readonly connection = inject.optional(ClientConnection);

  private inner: ClientSessions | undefined;

  onInit(ctx: Context): void {
    // 上游 `ClientSessions` 要一个真 cordis ctx 来挂 scope fiber（`createScope`）与收尾 effect；
    // 行 ctx 就是它。它自己那句 `reflect.provide('sessions', this)` 落在 cordis store 上：
    // 服务名是上游自己的，我们的契约令牌另有身份（`session-controller`），两者不抢同一条目。
    this.inner = new ClientSessions(
      asUpstreamContext(ctx),
      new LiveSessionRemotes(
        () => this.sessionEndpoint,
        () => {
          const runner = this.commandRunner;
          if (runner === undefined)
            throw new Error("[sessions] command-runner 未装配：commands.execute 不可用");
          return runner;
        },
        () => this.remote,
        () => this.connection,
      ),
    );
    // **必须拉一次目录**：上游 `ClientSessions` 的构造只装 `list` 快照（`phase: 'pending'`），
    // 目录要 `refreshList()` 才有行；而 `retain(id)` 的 `resolveTarget` 会校验
    // `summaries` 里有没有这个 id（`sessions.retain: unknown session …`）。
    // 不拉的话：侧栏空、`retain` 全失败、主区永远停在 hero。
    void this.inner.refresh().catch((error: unknown) => {
      // 宿主没挂 「会话组」 时目录就是空的，保持空态即可，不炸装配。
      console.warn("[sessions] 首次拉取目录失败：%s", String(error));
    });
    // 宿主推的变化要喂给 `ClientSessions` 的 handle*：它自己只在构造里订阅了 manager 的投影，
    // 不接这条线的话侧栏不会跟着 added/removed/status 更新（列表停在首帧）。
    const sessions = this.inner;
    const offs = [
      this.remote.$on(
        "api-session/added",
        (summary: Parameters<ClientSessions["handleSessionAdded"]>[0]) => {
          sessions.handleSessionAdded(summary);
        },
      ),
      this.remote.$on(
        "api-session/removed",
        (id: Parameters<ClientSessions["handleSessionRemoved"]>[0]) => {
          sessions.handleSessionRemoved(id);
        },
      ),
      this.remote.$on(
        "api-session/status",
        (
          id: Parameters<ClientSessions["handleSessionStatus"]>[0],
          running: Parameters<ClientSessions["handleSessionStatus"]>[1],
        ) => {
          sessions.handleSessionStatus(id, running);
        },
      ),
    ];
    // 会话内的事件帧交给 `ClientSessions.handleControlFrame`（它管会话的生命周期面）。
    // **与 `Projections` 那条流并存**：`Projections.open()` 只把帧折进**它自己**的投影 store，
    // 而 `binding().session.projections`（模型选择、权限 chip 读的都是它）只吃这一条线。
    //
    // 换代必须**重开**：连接一换，旧 socket 上的流就断了，而这条流之后没有别的时机再开
    // （`Projections` 那边也是这么做的）。不重开的症状：界面上所有"宿主算出来的值"冻在旧值，
    // 刷新（= 新装配）才好——模型选择切了没反应就是这个形态。
    this.stopGeneration = this.connection?.generation.subscribe(() => {
      this.openControl();
    });
    this.openControl();
    ctx.effect(() => () => {
      this.stopControl();
      this.stopGeneration?.();
      this.stopGeneration = undefined;
      for (const off of offs) off();
    });
  }

  onDispose(): void {
    // `ClientSessions` 自己在 `rootCtx.effect` 里做了 dispose（含 manager 的静默期），这里只清引用。
    this.stopControl();
    this.stopGeneration?.();
    this.stopGeneration = undefined;
    this.inner = undefined;
    this.catalog = undefined;
  }

  /** 停掉当前这条 `session/control` 流（换代重开与卸载共用）。 */
  private stopControl(): void {
    this.stopStream?.();
    this.stopStream = undefined;
  }

  /** 连接代订阅的退订函数。 */
  private stopGeneration: (() => void) | undefined;

  /** 当前这条 `session/control` 流的停止函数。 */
  private stopStream: (() => void) | undefined;

  /**
   * 开一条 `session/control` 流（幂等：先停旧的）。
   *
   * 等的是**这个 namespace**（不是"第一次 `$mount`"）：组是各行分别挂的，
   * 先挂上的那个与 `session` 组无关；按名字等才不受装配顺序影响。
   */
  private openControl(): void {
    this.stopControl();
    const sessions = this.inner;
    if (sessions === undefined) return;
    const controller = new AbortController();
    this.stopStream = () => {
      controller.abort();
    };
    void (async (): Promise<void> => {
      try {
        await this.remote.whenNamespace(sessionGroupName());
        if (controller.signal.aborted) return;
        // 契约面把帧声明成裸 `sessionId` + 不透明值（跨端值不引宿主包）；上游 `handleControlFrame`
        // 要的是 branded 的同一份帧——同一条 wire 的两种声明，这里按上游那一份转一次。
        const frames = this.sessionEndpoint.control(
          controller.signal,
        ) as AsyncIterable<ControlFrame>;
        for await (const frame of frames) {
          sessions.handleControlFrame(frame);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          console.warn("[sessions] session/control 流结束：%s", String(error));
      }
    })();
  }

  /** 上游实例；`onInit` 之前访问是装配错误，直接说清楚。 */
  private get sessions(): ClientSessions {
    if (this.inner === undefined) throw new Error("[sessions] 行还没 onInit：装配顺序错了");
    return this.inner;
  }

  /**
   * 目录读面：上游 `SnapshotStore<SessionListState>` → 契约的 `SessionCatalog`。
   *
   * 两处差别都在**取值**上，不在数据上：上游 `phase` 是 `'pending' | 'ready'`（`SessionListPhase`，
   * 拉取失败走 `state`/`error` 那条轴，没有 `failed` 相位），契约面用 `'loading'` 表达"还没拉完"。
   * 行（`ids` / `byId` / `projectionsBySession`）是同一份快照，不复制。
   */
  get list(): SessionController["list"] {
    // 装配期就可能被别的行的订阅读到（上游 `ui-session-status` 在 status 快照变化时读 `sessions.list`）：
    // 那时本行还没 `onInit`，上游 `ClientSessions` 不存在。给「空且 loading」的读面而不是抛——
    // 抛出去只会被第三方 store 的订阅器吞成一条 `subscriber failed`，读的人还是什么都没拿到。
    // 空读面**不缓存**到实例上：`onInit` 之后这里要换成真读面。
    if (this.inner === undefined) return EMPTY_CATALOG;
    // 读面本身也**只造一次**：`subscribe` / `getSnapshot` 的身份得稳定（`useSyncExternalStore` 的依赖）。
    this.catalog ??= this.catalogView();
    return this.catalog;
  }

  /** 契约面的目录读面（`get list` 造一次就存在这里）。 */
  private catalog: SessionController["list"] | undefined;

  /**
   * 造一次目录读面，快照按**来源身份**缓存。
   * @returns 契约面的 `SessionCatalog`。
   */
  private catalogView(): SessionController["list"] {
    const store = this.sessions.list;
    let source: ReturnType<typeof store.getSnapshot> | undefined;
    let view: SessionCatalogState | undefined;
    return {
      getSnapshot: () => {
        const state = store.getSnapshot();
        if (state === source && view !== undefined) return view;
        source = state;
        view = {
          ids: state.ids,
          byId: state.byId,
          phase: state.phase === "pending" ? "loading" : state.phase,
          projectionsBySession: state.projectionsBySession,
        };
        return view;
      },
      subscribe: (listener) => store.subscribe(listener),
    };
  }

  get searchResultLimit(): SessionController["searchResultLimit"] {
    return this.sessions.searchResultLimit;
  }

  create(
    opts?: Parameters<SessionController["create"]>[0],
  ): ReturnType<SessionController["create"]> {
    return this.sessions.create(opts);
  }

  fork(opts: Parameters<SessionController["fork"]>[0]): ReturnType<SessionController["fork"]> {
    return this.sessions.fork(opts);
  }

  search(
    ...args: Parameters<SessionController["search"]>
  ): ReturnType<SessionController["search"]> {
    return this.sessions.search(...args);
  }

  refresh(): ReturnType<SessionController["refresh"]> {
    return this.sessions.refresh();
  }

  refreshProjections(
    sessionId: Parameters<SessionController["refreshProjections"]>[0],
  ): ReturnType<SessionController["refreshProjections"]> {
    return this.sessions.refreshProjections(sessionId);
  }

  subagentAddress(
    sessionId: Parameters<SessionController["subagentAddress"]>[0],
  ): ReturnType<SessionController["subagentAddress"]> {
    return this.sessions.subagentAddress(sessionId);
  }

  scopeOf(ctx: Context): ReturnType<SessionController["scopeOf"]> {
    return this.sessions.scopeOf(asUpstreamContext(ctx));
  }

  scope(id: Parameters<SessionController["scope"]>[0]): ReturnType<SessionController["scope"]> {
    // 收窄断言：契约的 `SessionScope` 是"本装配真正给出的成员"子集（见契约注释），运行时对象就是
    // 上游的 `AgentContext`——**不换对象**：`sessionOf` 靠 ctx 上的标签反查会话，包一层就断链。
    return this.sessions.scope(id) as unknown as SessionScope | undefined;
  }

  sessionOf(
    ctx: Parameters<SessionController["sessionOf"]>[0],
  ): ReturnType<SessionController["sessionOf"]> {
    // 同上：`SessionView` 是上游 `SessionFace` 的读面子集，成员签名不同（`projections.faceOf` 上游要 key），
    // 但对象是同一个——消费方拿它读快照、订阅，不认身份差异。
    return this.sessions.sessionOf(asUpstreamContext(ctx)) as unknown as SessionView | undefined;
  }

  get(id: string): unknown {
    return this.sessions.binding(id as Parameters<ClientSessions["binding"]>[0]);
  }

  binding(id: string): unknown {
    return this.sessions.binding(id as Parameters<ClientSessions["binding"]>[0]);
  }

  retainInfo(id: string): ReturnType<SessionController["retainInfo"]> {
    return this.sessions.retainInfo(id as Parameters<ClientSessions["retainInfo"]>[0]);
  }

  retain(
    target: Parameters<SessionController["retain"]>[0],
    options: Parameters<SessionController["retain"]>[1],
  ): ReturnType<SessionController["retain"]> {
    return retainHandleOf(this.sessions.retain(target, options));
  }

  using<T>(
    target: Parameters<SessionController["using"]>[0],
    options: Parameters<SessionController["using"]>[1],
    operation: (reference: SessionRetainHandle) => T | Promise<T>,
  ): Promise<T> {
    // 句柄面按契约转一次：上游只有 `release()` 与 `[Symbol.dispose]`，契约面声明的是 `release()` / `dispose()`。
    return this.sessions.using(target, options, (reference) =>
      operation(retainHandleOf(reference)),
    );
  }
}
