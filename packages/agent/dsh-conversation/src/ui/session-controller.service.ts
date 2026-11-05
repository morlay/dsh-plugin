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
import { CommandRunner } from "@morlay/dsh-command/endpoint";
import { Connection, Remote, SessionRemote } from "@morlay/zephyr-app/client";
import { SessionController } from "../contract/session-controller.contract.ts";
import { LiveSessionRemotes } from "./remote-session.ts";
import { SESSION_GROUP } from "@morlay/dsh-session/endpoint";

@Injectable()
export class SessionControllerDefault extends SessionController implements OnInit, OnDispose {
  private readonly remote = inject(Remote);

  /** `session` 面的真身：契约服务（装配期就有，不等 `$mount`）。 */
  private readonly sessionRemote = inject(SessionRemote);

  /** `commands.execute` 的真身：我们的命令执行器。 */
  /**
   * 命令执行器：**可选**——只测 `session` 面的装配（如 `sessions-create.spec`）可以不装它。
   * 上游 `commands.execute` 落到这里；没装时那一路报明确的"未挂载"而不是让整个行失败。
   */
  private readonly commandRunner = inject.optional(CommandRunner);

  /** 连接面：**可选**——只测数据面的装配没有它，按单代跑（上游流生命周期的重连因此不触发）。 */
  private readonly connection = inject.optional(Connection);

  private inner: ClientSessions | undefined;

  onInit(ctx: Context): void {
    // 上游 `ClientSessions` 要一个真 cordis ctx 来挂 scope fiber（`createScope`）与收尾 effect；
    // 行 ctx 就是它。它自己那句 `reflect.provide('sessions', this)` 落在 cordis store 上：
    // 服务名是上游自己的，我们的契约令牌另有身份（`session-controller`），两者不抢同一条目。
    this.inner = new ClientSessions(
      ctx,
      new LiveSessionRemotes(
        () => this.sessionRemote,
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
      this.remote.$on("api-session/added", (summary: never) => {
        sessions.handleSessionAdded(summary);
      }),
      this.remote.$on("api-session/removed", (id: never) => {
        sessions.handleSessionRemoved(id);
      }),
      this.remote.$on("api-session/status", (id: never, running: never) => {
        sessions.handleSessionStatus(id, running);
      }),
    ];
    // 会话内的事件帧交给 `ClientSessions.handleControlFrame`（它管会话的生命周期面）。
    // **与 `Projections` 那条流并存**：`Projections.open()` 只把帧折进投影 store，
    // 会话侧的内容/状态要靠 `handleControlFrame`——去掉这一条，17 条 spec 会一起红。
    const controller = new AbortController();
    // 等 `session` namespace 挂上再开流：装配期它还没登记（或挂到未就绪的 typert gateway 上），
    // 那时开会以一条错误结束，而这条流之后没有别的时机再被重开。
    void this.remote.whenMounted().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const face = (this.remote as unknown as Record<string, unknown>)[
          SESSION_GROUP
        ] as unknown as { control?(signal: AbortSignal): AsyncIterable<unknown> } | undefined;
        if (typeof face?.control !== "function") return;
        for await (const frame of face.control(controller.signal)) {
          sessions.handleControlFrame(frame as never);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          console.warn("[sessions] session/control 流结束：%s", String(error));
      }
    });
    ctx.effect(() => () => {
      controller.abort(new Error("sessions row disposed"));
      for (const off of offs) off();
    });
  }

  onDispose(): void {
    // `ClientSessions` 自己在 `rootCtx.effect` 里做了 dispose（含 manager 的静默期），这里只清引用。
    this.inner = undefined;
  }

  /** 上游实例；`onInit` 之前访问是装配错误，直接说清楚。 */
  private get sessions(): ClientSessions {
    if (this.inner === undefined) throw new Error("[sessions] 行还没 onInit：装配顺序错了");
    return this.inner;
  }

  get list(): SessionController["list"] {
    return this.sessions.list as unknown as SessionController["list"];
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
    return this.sessions.scopeOf(ctx);
  }

  scope(id: Parameters<SessionController["scope"]>[0]): ReturnType<SessionController["scope"]> {
    return this.sessions.scope(id) as unknown as ReturnType<SessionController["scope"]>;
  }

  sessionOf(
    ctx: Parameters<SessionController["sessionOf"]>[0],
  ): ReturnType<SessionController["sessionOf"]> {
    return this.sessions.sessionOf(ctx as unknown as never) as unknown as ReturnType<
      SessionController["sessionOf"]
    >;
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
    return this.sessions.retain(target, options) as unknown as ReturnType<
      SessionController["retain"]
    >;
  }

  using<T>(
    target: Parameters<SessionController["using"]>[0],
    options: Parameters<SessionController["using"]>[1],
    operation: Parameters<SessionController["using"]>[2],
  ): Promise<T> {
    // 引用类型的名义差异（我们的 `SessionRetainHandle` 对上上游 `SessionReference`）：运行时同形，边界处断言一次。
    return this.sessions.using(target as never, options as never, operation as never) as Promise<T>;
  }
}
