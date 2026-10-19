// sessions 行：**只提供服务**，契约面与上游一致（`list` / `retain` / `using`）。
//
// 内部**自己实现**：不组合上游 `ClientSessions`，也不再读上游的整组面（`face`）。
// 与上游唯一的对齐点是 `SessionRemote` 的**契约方法**（`@RemoteGroup` 那一层负责对上）。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, resolveServiceName, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { SessionRemote } from "@morlay/zephyr-app/client";
import { CommandRunner } from "@morlay/dsh-command/endpoint";
import { MutableSessionEventSource, type SessionEventLikeEntry } from "@deepseek-ai/dsh-api-session-controller/client";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {
  SessionController,
  type SessionCatalog,
  type SessionCatalogState,
  type SessionRetainHandle,
  type SessionScope,
  type SessionView,
} from "./session-controller.contract.ts";
import { promptContentOf, queueActionOf } from "./session-submission.ts";

/**
 * 会话目录的 store：快照可变（`refresh()` 写回），消费方订阅后能收到新快照。
 *
 * 快照类型就是契约的 `SessionCatalogState`：`ids` 是 Host 列表顺序，`byId` 行是 Host 原样透传的对象。
 */
function createListStore(): SessionCatalog & { set(next: Partial<SessionCatalogState>): void } {
  let state: SessionCatalogState = { ids: [], byId: {}, phase: "ready", projectionsBySession: {} };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (next) => {
      state = { ...state, ...next };
      for (const fn of listeners) fn();
    },
  };
}

/** `remote.session` 里本行用到的那一面（上游 `SessionRemote` 的 `follow`：命名参数 + 取消信号 → 帧流）。 */
interface SessionFollowFace {
  follow(
    request: { readonly address: { readonly sessionId: string } },
    signal: AbortSignal,
  ): AsyncIterable<unknown> & { dispose(): Promise<void> };
}

/** 没有 `retainedBy` 的行共用的空值（`retainInfo.getSnapshot()` 要保持引用稳定）。 */
const EMPTY_RETAINED_BY: Readonly<Record<string, number>> = {};

/** 判据是「这个成员是不是函数」——命名空间是否存在由 descriptor 登记决定，不看类型。 */
function hasFollow(value: unknown): value is SessionFollowFace {
  return typeof value === "object" && value !== null && "follow" in value && typeof value.follow === "function";
}

@Injectable()
export class SessionControllerDefault extends SessionController implements OnInit {
  private readonly sessionRemote = inject(SessionRemote);

  private readonly remote = inject(Remote);

  /**
   * 命令执行器（`commands/execute` 的端口）。
   *
   * optional：只有装了命令面才有。**上游 chip 正是经 `binding.session.command('/permission …')` 写权限**，
   * 缺了它那次调用会抛 `session.command is not a function`，而调用方 `.catch(() => false)` 把它吞掉——
   * 表现就是「点了确认什么都不发」。
   */
  private readonly commands = inject.optional(CommandRunner);

  private readonly store = createListStore();

  /** 每个会话的最小 `SessionBinding`（同一实例，`ui-session` 会按身份比对）。 */
  private readonly bindings = new Map<string, unknown>();

  /** 每个会话的 `session/follow` 订阅（`eventSource` 的唯一数据来源）。 */
  private readonly follows = new Map<string, { dispose(): Promise<void> }>();

  /**
   * 每条 binding 的「行变了，重读快照」出口。
   *
   * `blank` / `running` 是**目录行**上的判据（宿主 `blank: session.seq === 0`），binding 只是把它
   * 翻译成 `SessionSnapshot`。行被 Host 推送或列表刷新改掉时要让订阅者看到，否则主区形态会停在旧值上。
   */
  private readonly bindingRefreshers = new Map<string, () => void>();

  /** `onInit` 拿到的行作用域（binding 的 `ctx` 要它，`ui-session` 会调 `ctx.effect`）。 */
  private context: Context | undefined;

  /** 每行的 `retainInfo` 通知集合。 */
  private readonly retainInfoListeners = new Map<string, Set<() => void>>();

  /** `retainInfo` 的每行通知集合与 identity-stable face（`ui-session` 只绑一次）。 */
  private readonly retainInfoFaces = new Map<
    string,
    { getSnapshot(): { retainedBy: Readonly<Record<string, number>> }; subscribe(listener: () => void): () => void }
  >();

  /** 会话目录（`ids` 是 Host 列表顺序；`byId` 是行）。 */
  readonly list: SessionCatalog = this.store;

  /**
   * 保留一个会话（`retain`）——本装配里没有引用计数，只返回它的 disposer。
   * @param _target - 会话身份。
   * @param _options - 保留选项。
   * @returns 释放函数。
   */
  /** 客户端没有会话实例（那是宿主侧的事）。 */
  get(_id: string): unknown {
    return undefined;
  }

  /** 每个会话的作用域对象（普通对象，不是行作用域代理：上游会直接读 `ctx.sessionId`）。 */
  private readonly scopes = new Map<string, SessionScope>();

  /**
   * 开 `session/follow` 并把帧灌进 `eventSource`。
   *
   * 这是消息流的**唯一**数据通道：`snapshot` 帧给完整窗口（`records` 就是 `SessionEventLikeEntry`），
   * 之后逐条 `{ type: 'event', event }`。宿主侧现在只发空窗口，所以界面上是「空对话 + 输入框」；
   * 宿主一有事件，这里不用改。
   */
  private startFollow(
    id: string,
    source: MutableSessionEventSource,
    applyProjections: (values: Readonly<Record<string, unknown>>) => void,
  ): void {
    if (this.follows.has(id)) return;
    // `remote.<namespace>` 是 `Remote` 实现上的 Proxy 回落（descriptor 登记后才存在），契约只声明了 `$mount`/`$on`，
    // 所以这里按「成员存在性」收窄，而不是把契约对象断言成某个形状。
    const namespace: unknown = Reflect.get(this.remote, "session");
    if (!hasFollow(namespace)) return;
    const controller = new AbortController();
    const stream = namespace.follow({ address: { sessionId: id } }, controller.signal);
    this.follows.set(id, stream);
    void (async (): Promise<void> => {
      try {
        for await (const frame of stream) {
          const snapshot = frame as {
            type?: string;
            records?: readonly SessionEventLikeEntry[];
            hasMore?: boolean;
            event?: SessionEventLikeEntry;
          };
          if (snapshot.type === "snapshot") {
            source.replace(snapshot.records ?? [], snapshot.hasMore ?? false);
            // 首帧的投影是 Host 的 sequenced 值：`faceOf(key)` 从这里拿到 `modelSelection` 这类键。
            const projections = (frame as { projections?: { values?: Readonly<Record<string, unknown>> } })
              .projections;
            if (projections?.values !== undefined) applyProjections(projections.values);
          } else if (snapshot.type === "event" && snapshot.event !== undefined) {
            source.append(snapshot.event);
          }
        }
      } catch {
        // 取消、或宿主没有这条流：保持空窗口（界面照常）。
      }
    })();
  }

  /** 一个会话的作用域：把 binding 的 `ctx` 与 sessionId 一起给出去（`sessionOf` 靠它反查）。 */
  scope(id: Parameters<SessionController["scope"]>[0]): ReturnType<SessionController["scope"]> {
    if (this.store.getSnapshot().byId[id] === undefined) return undefined;
    const existing = this.scopes.get(id);
    if (existing !== undefined) return existing;
    const scopeCtx = {
      sessionId: id,
      effect: (fn: () => unknown): (() => void) => {
        const undo = fn();
        return () => {
          if (typeof undo === "function") (undo as () => void)();
        };
      },
      // 会话作用域里的 `ctx.get(name)`：查根名字视图（`conversation` 这类跨行服务由令牌发布到那里）。
      get: (name?: string): unknown =>
        name === undefined || this.context === undefined
          ? undefined
          : resolveServiceName(this.context, name),
      // 上游在会话作用域上订阅事件（`actx.on('...')`）：本装配没有会话事件源，给空订阅。
      on: (): (() => void) => () => {},
      emit: (): void => {},
      off: (): void => {},
      // 上游用 `ctx.inject([names], cb)`：cordis 给回调的是**同一个 ctx**（依赖已就绪），
      // 所以这里回传作用域本身——上游会在回调里写 `scope.effect(...)`、`scope.get(...)`。
      inject: (names: readonly string[], callback?: (scope: unknown) => unknown): unknown => {
        void names;
        const run = Promise.resolve().then(() => callback?.(scopeCtx));
        return Object.assign(run, { dispose: (): void => {} });
      },
    };
    this.scopes.set(id, scopeCtx);
    return scopeCtx;
  }

  /** 从作用域反查会话面。 */
  sessionOf(ctx: Parameters<SessionController["sessionOf"]>[0]): ReturnType<SessionController["sessionOf"]> {
    const binding = this.binding(ctx.sessionId) as { session?: SessionView } | undefined;
    return binding?.session;
  }

  /**
   * 一行的 `SessionBinding`：`ui-session` 用它 materialize 出会话 scope 的标准源
   * （`conversation` / `useSession` 都从这里来），`ui-conversation` 的消息区也挂在它上面。
   *
   * 本装配给的是**最小 binding**：`session` 面用懒代理兜住未实现的成员，`eventSource` 是空窗口
   * （所以有输入区、没有历史消息）。接上 `session/open` + 事件流后这份实现才会被替换。
   */
  binding(id: string): unknown {
    const listSnapshot = this.store.getSnapshot();
    // **`ids` 是权威列表**：`byId` 可能在列表刷新后残留（宿主推送 / 局部写入），只查 `byId` 会让
    // 一个「已经不在列表里」的 id 继续拿到 binding，`ui-session` 的 `publishMain` 就会把它当 main，
    // 主区停在一个不存在的会话上（`data-phase="active"` 而不是 `hero`）。
    if (!listSnapshot.ids.includes(id)) return undefined;
    const row = listSnapshot.byId[id];
    if (row === undefined) return undefined;
    const existing = this.bindings.get(id);
    if (existing !== undefined) return existing;
    const summary = row as { id?: string; title?: string; cwd?: string; running?: boolean };
    // `SessionSnapshot` 的字段一个都不能少：`ChatView` / `QueueDock` 直接读 `.pendingSubmissions.length|filter`，
    // 缺字段就是错误边界里的 `undefined.length`（上游只对有会话生命周期的实例做这份快照）。
    const pending: {
      readonly requestId: string;
      readonly placement: "queued" | "transcript";
      readonly time: number;
      readonly text: string;
      readonly attachments: readonly unknown[];
    }[] = [];
    const snapshot = {
      sessionId: id,
      pendingSubmissions: pending,
      running: summary.running ?? false,
      subagent: null,
      removed: false,
      openState: "open",
      openError: null,
      hasMore: false,
      loadingOlder: false,
      promptError: null as unknown,
      // 初值只是占位：`snapshotOf()` 每次都从目录行重读（见那里的注释）。
      blank: false,
      lastAgentError: null,
      promptAttempted: false,
      awaitingFirstTurn: false,
    };
    const absentObservable = {
      getSnapshot: (): undefined => undefined,
      subscribe: (): (() => void) => () => {},
    };
    /**
     * 会话投影的客户端读面（上游 `ProjectionValueStore.faceOf` 的语义）。
     *
     * 值的两个来源：目录行的 `projectionValues`（cached，`session/list` 给）与 `session/follow`
     * 首帧的 `projections.values`（sequenced，Host 计算的当前值）。同一键以后者为准——它属于当前连接代。
     * 缺键读 `undefined`（与上游一致：能力缺失，不是错误）。
     */
    const projectionRows = new Map<string, { value: unknown; fromFrame: boolean }>();
    const projectionFaces = new Map<
      string,
      { getSnapshot(): unknown; subscribe(listener: () => void): () => void }
    >();
    const projectionListeners = new Set<() => void>();
    const notifyProjections = (): void => {
      for (const listener of projectionListeners) listener();
    };
    /** 行上的 cached 值：只在没有帧值时填（帧值更新）。 */
    const seedRowProjections = (): void => {
      const row = this.store.getSnapshot().byId[id] as
        | { projectionValues?: Record<string, unknown> }
        | undefined;
      const values = row?.projectionValues;
      if (values === undefined) return;
      for (const [key, value] of Object.entries(values)) {
        if (projectionRows.get(key)?.fromFrame === true) continue;
        projectionRows.set(key, { value, fromFrame: false });
      }
    };
    /** follow 首帧的 sequenced 值。 */
    const applyFrameProjections = (values: Readonly<Record<string, unknown>>): void => {
      for (const [key, value] of Object.entries(values)) {
        projectionRows.set(key, { value, fromFrame: true });
      }
      notifyProjections();
    };
    /** 一个键的 identity-stable 读面（React 侧只绑一次）。 */
    const faceOfProjection = (key: string): {
      getSnapshot(): unknown;
      subscribe(listener: () => void): () => void;
    } => {
      const existing = projectionFaces.get(key);
      if (existing !== undefined) return existing;
      const face = {
        getSnapshot: (): unknown => projectionRows.get(key)?.value,
        subscribe: (listener: () => void): (() => void) => {
          projectionListeners.add(listener);
          return (): void => {
            projectionListeners.delete(listener);
          };
        },
      };
      projectionFaces.set(key, face);
      return face;
    };
    const listeners = new Set<() => void>();
    /** 本端是否已经发出过一条被宿主收下的 prompt（上游 `Session.handleBlank(false)` 的同一条语义）。 */
    let engaged = false;
    /** 目录行的当前值：`blank`（空白会话）与 `running` 的唯一权威。 */
    const rowOf = (): { blank?: unknown; running?: unknown } | undefined =>
      this.store.getSnapshot().byId[id] as { blank?: unknown; running?: unknown } | undefined;
    const snapshotOf = (): typeof snapshot => {
      const row = rowOf();
      return {
        ...snapshot,
        // 空白会话的判据是宿主行上的 `blank`（`session.seq === 0`）：上游 `conversationPhase` 读这一位，
        // 决定主区是 hero（居中输入）还是常驻底部输入栏。本地发出过 prompt 后不再回退成 blank。
        blank: !engaged && row?.blank === true,
        running: row?.running === true,
        pendingSubmissions: [...pending],
      };
    };
    let current = snapshotOf();
    const publish = (): void => {
      current = snapshotOf();
      seedRowProjections();
      for (const listener of listeners) listener();
    };
    this.bindingRefreshers.set(id, publish);
    const retire = (requestId: string): void => {
      const index = pending.findIndex((entry) => entry.requestId === requestId);
      if (index < 0) return;
      pending.splice(index, 1);
      publish();
    };
    // 每条 echo 的结算钩子（上游 `SubmissionHandle` 的 `onAccept` / `onRetire`）。
    const settlements = new Map<string, {
      readonly onAccept?: () => void;
      readonly onRetire?: (retirement: { readonly kind: string }) => void;
      accepted: boolean;
    }>();
    /**
     * 结算一条 echo（**幂等**，上游语义）：
     * - `accepted`：宿主收下了 → 调 `onAccept`，**echo 保留**（等 Host 的 Inbox/事件接管后再清）；
     * - `failed` / `abandoned`：立刻移除 echo 并调一次 `onRetire`。
     */
    const settle = (requestId: string, kind: "accepted" | "failed" | "abandoned"): void => {
      const settlement = settlements.get(requestId);
      if (settlement === undefined) return;
      if (kind === "accepted") {
        if (settlement.accepted) return;
        settlement.accepted = true;
        settlement.onAccept?.();
        return;
      }
      settlements.delete(requestId);
      retire(requestId);
      settlement.onRetire?.({ kind });
    };
    const session = new Proxy(
      {
        // `sessionId` 必须在这里：上游拿 `session.sessionId` 反查 binding 并做身份比对
        // （`ui-input-trigger` 的 `sessionOf` 就是），缺了会走 Proxy 的兜底函数 → `requires a retained Session scope`。
        sessionId: id,
        getSnapshot: (): typeof snapshot => current,
        subscribe: (listener: () => void): (() => void) => {
          listeners.add(listener);
          return (): void => {
            listeners.delete(listener);
          };
        },
        // 乐观 echo：返回身份与「发送前放弃」的出口（上游 `SubmissionHandle` 的形状）。
        beginSubmission: (input: {
          readonly mode: "queue" | "steer";
          readonly text: string;
          readonly attachments?: readonly unknown[];
          readonly onAccept?: () => void;
          readonly onRetire?: (retirement: { readonly kind: string }) => void;
        }): { readonly requestId: string; abandon(): void } => {
          const requestId = globalThis.crypto.randomUUID();
          const entry = {
            requestId,
            placement: summary.running === true ? "queued" as const : "transcript" as const,
            time: Date.now(),
            text: input.text,
            attachments: input.attachments ?? [],
          };
          pending.push(entry);
          settlements.set(requestId, {
            ...(input.onAccept === undefined ? {} : { onAccept: input.onAccept }),
            ...(input.onRetire === undefined ? {} : { onRetire: input.onRetire }),
            accepted: false,
          });
          publish();
          return { requestId, abandon: (): void => settle(requestId, "abandoned") };
        },
        prompt: async (
          content: readonly unknown[],
          mode: "queue" | "steer",
          signal?: AbortSignal,
          requestId?: string,
        ): Promise<unknown> => {
          const face = this.remote.session;
          if (face === undefined) throw new Error("[sessions] remote.session 尚未挂载（SessionRemote 行未装）");
          const result = await face.prompt(
            {
              requestId: requestId ?? globalThis.crypto.randomUUID(),
              sessionId: id,
              mode,
              content: promptContentOf(content),
            },
            signal,
          );
          if (requestId !== undefined) {
            // 成功只「接受」（echo 保留给 Host 事件接管）；失败才退役并镜像到 `promptError`。
            // **不 mock 成功**：真实失败码要原样返回给 UI。
            settle(requestId, result.ok ? "accepted" : "failed");
          }
          if (result.ok && !engaged) {
            // 首发被收下 → 这条会话不再是空白会话（与上游 `onEngaged` 同义）：主区立刻从 hero
            // 切到底部常驻输入栏，而不是等下一次 `session/list` 回来。
            engaged = true;
            publish();
            // **目录行也要跟着改**：侧栏的树构建按 `blank` 过滤（空白行只显示当前那条），
            // 只改 binding 的话，刚发出第一条消息的会话在侧栏里仍然是隐藏的。
            this.markEngaged(id);
          }
          if (!result.ok) {
            snapshot.promptError = result.error;
            publish();
          }
          return result;
        },
        cancel: async (): Promise<unknown> => {
          const face = this.remote.session;
          if (face === undefined) throw new Error("[sessions] remote.session 尚未挂载（SessionRemote 行未装）");
          // 本地先放弃所有未结算的 echo（用户取消/离开），再请宿主取消正在跑的轮次。
          for (const requestId of Array.from(settlements.keys())) settle(requestId, "abandoned");
          return await face.cancel({ sessionId: id });
        },
        updateQueue: async (itemId: string, action: unknown): Promise<unknown> => {
          const face = this.remote.session;
          if (face === undefined) throw new Error("[sessions] remote.session 尚未挂载（SessionRemote 行未装）");
          return await face.updateQueue({ sessionId: id, itemId, action: queueActionOf(action) });
        },
        rename: async (title: string): Promise<unknown> => {
          const face = this.remote.session;
          if (face === undefined) throw new Error("[sessions] remote.session 尚未挂载（SessionRemote 行未装）");
          return await face.rename({ sessionId: id, title });
        },
        command: async (
          line: string,
        ): Promise<{ ok: boolean; value?: { matched: boolean }; error?: { code: string; message: string } }> => {
          const runner = this.commands;
          if (runner === undefined) {
            // 不静默：上游 chip 会把 `ok:false` 变成一次 `throw`，而它的调用方 `.catch(() => false)`
            // 会吞掉——所以这里必须自己留痕，否则「点了没反应」永远查不到原因。
            console.warn("[sessions] command(%s)：命令面没装（CommandRunner 未注册）", line);
            return { ok: false, error: { code: "commands/unavailable", message: "命令面没装（CommandRunner 未注册）" } };
          }
          const trimmed = line.trim().replace(/^\//, "");
          const space = trimmed.indexOf(" ");
          const name = space === -1 ? trimmed : trimmed.slice(0, space);
          const input = space === -1 ? undefined : trimmed.slice(space + 1);
          try {
            await runner.run(SessionId(id), name, input);
            return { ok: true, value: { matched: true } };
          } catch (error) {
            console.warn("[sessions] command(%s) 失败：", line, error);
            return { ok: false, error: { code: "commands/failed", message: String(error) } };
          }
        },
        // 结构型成员要有**正确的形状**（上游直接 `.faceOf(...)` / `.getSnapshot()`，
        // 给 async 函数会变成 `xxx is not a function`）。
        projections: { faceOf: faceOfProjection },
        queue: { getSnapshot: (): readonly unknown[] => [], subscribe: absentObservable.subscribe },
      },
      {
        // `ISession` 的方法很多，本装配一个都没实现：未知成员给一个「明确失败」的 async 函数，
        // 而不是 `undefined`（后者会让上游在 `binding.session.xxx()` 上抛 TypeError，还看不出是谁）。
        get: (target, property) => {
          if (Reflect.has(target, property)) return Reflect.get(target, property);
          if (typeof property !== "string") return undefined;
          return async (): Promise<never> => {
            throw new Error(`[sessions] 本装配没有实现 session.${property}()`);
          };
        },
      },
    );
    // 用上游的事件源实现构造「空窗口」：`change` / `revision` 这些字段的形状由它保证，
    // 手写 `{ change: {} }` 会让 `ConversationController` 在内部读到 undefined（`undefined.length`）。
    const eventSource = new MutableSessionEventSource();
    const binding = {
      sessionId: id,
      session,
      eventSource,
      // `ctx` 给**会话作用域对象**而不是行作用域代理：上游组件会直接读 `ctx.sessionId`，
      // 行作用域的读面会抛 `cannot get property "sessionId" without inject`。
      ctx: this.scope(SessionId(id)),
    };
    seedRowProjections();
    this.bindings.set(id, binding);
    this.startFollow(id, eventSource, applyFrameProjections);
    return binding;
  }

  /**
   * 一行的保留信息：**就是这一行的 `retainedBy`**。
   *
   * 上游 `ui-session` 的 `publishMain` 用它判断「当前 main 是否仍是 main」，并订阅它重算；
   * 恒空会让判断永远失败、回落成「扫 `byId` 找第一个 `mainView > 0`」，旧会话的残留计数就把主区
   * 钉在旧会话上（症状：点「新建会话」后主区不切到新的空白会话）。
   * @param id - 会话身份。
   * @returns 该行的保留信息 observable（行不存在时为空计数）。
   */
  retainInfo(id: string): {
    getSnapshot(): { retainedBy: Readonly<Record<string, number>> };
    subscribe(listener: () => void): () => void;
  } {
    const existing = this.retainInfoFaces.get(id);
    if (existing !== undefined) return existing;
    const listeners = new Set<() => void>();
    this.retainInfoListeners.set(id, listeners);
    /** 快照包装按行值缓存：同一个 `retainedBy` 对象 → 同一个快照引用（`useSyncExternalStore` 要的）。 */
    let cached: { retainedBy: Readonly<Record<string, number>> } | undefined;
    const face = {
      getSnapshot: (): { retainedBy: Readonly<Record<string, number>> } => {
        const retainedBy =
          (this.store.getSnapshot().byId[id] as { retainedBy?: Record<string, number> } | undefined)
            ?.retainedBy ?? EMPTY_RETAINED_BY;
        if (cached === undefined || cached.retainedBy !== retainedBy) cached = { retainedBy };
        return cached;
      },
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return (): void => {
          listeners.delete(listener);
        };
      },
    };
    this.retainInfoFaces.set(id, face);
    return face;
  }

  retain(
    target: Parameters<SessionController["retain"]>[0],
    options: Parameters<SessionController["retain"]>[1],
  ): SessionRetainHandle {
    // 本装配没有引用计数，但 **形状必须与上游 `SessionReference` 一致**：
    // `ui-workspace` 的 `replaceMain`/`restoreSelection` 会调 `reference.release()`
    // 与 `reference.sessionId`（缺了就是 `reference.release is not a function`）。
    // 目标可能是普通会话，也可能是子代理地址；两者都带一个真正的会话身份（子代理用子会话）。
    const sessionId = typeof target === "string" ? target : target.childSessionId;
    // `retainedBy` 要写回 store：`ui-session` 的 `current` 就是从「`retainedBy.mainView > 0`」挑出来的，
    // 不写的话会话主视图永远拿不到 binding（表现：选中会话后主区不出输入框）。
    // **按 source 分别计数**：侧栏 / 技能目录 / 主视图各自持有引用；把它们记成同一个键会让
    // `mainView > 0` 永远为真，主区就切不到新的空白会话（`source` 缺省时才用 `gateway`）。
    const source = options?.source ?? "gateway";
    this.markRetained(sessionId, source, +1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.markRetained(sessionId, source, -1);
    };
    return {
      sessionId,
      binding: this.binding(sessionId),
      ready: Promise.resolve(undefined),
      release,
      dispose: release,
    };
  }

  /** 本装配没有子代理：没有直系子代理地址。 */
  subagentAddress(_id: Parameters<SessionController["subagentAddress"]>[0]): undefined {
    return undefined;
  }

  /** 搜索条数上限：与上游同一常量（宿主没有索引面，`search` 会回失败）。 */
  readonly searchResultLimit = 20;

  /** 全文搜索：宿主没有索引面，回一个结构化的失败（UI 会把它显示成错误提示）。 */
  async search(
    _query: Parameters<SessionController["search"]>[0],
    _signal: Parameters<SessionController["search"]>[1],
  ): ReturnType<SessionController["search"]> {
    return {
      ok: false,
      error: new RemoteError("gateway/service-unavailable", "本装配没有会话搜索", { endpoint: "session/search" }),
    };
  }

  /** 分叉：宿主没有分叉面。 */
  async fork(_opts: Parameters<SessionController["fork"]>[0]): ReturnType<SessionController["fork"]> {
    throw new Error("本装配没有会话分叉");
  }

  /**
   * 在保留期内执行一段操作（`using`）。
   * @param target - 会话身份。
   * @param options - 保留选项。
   * @param operation - 要执行的操作。
   * @returns 操作结果。
   */
  async using<T>(
    target: Parameters<SessionController["using"]>[0],
    options: Parameters<SessionController["using"]>[1],
    operation: (reference: SessionRetainHandle) => T | Promise<T>,
  ): Promise<T> {
    const reference = this.retain(target, options);
    try {
      return await operation(reference);
    } finally {
      reference.dispose();
    }
  }

  /**
   * 建一个会话（`ui-workspace` 的「在某工作区新建会话」→ `sessions.create({ workspaceId })`）。
   *
   * 宿主回 `{ sessionId }`；会话行本身由 `api-session/added` 推送进 store，这里不预写。
   * @param opts - 目标 workspace / 目录、可复用的 blank、preset。
   * @returns 宿主建的会话身份。
   */
  async create(opts?: Parameters<SessionController["create"]>[0]): ReturnType<SessionController["create"]> {
    const result = (await this.sessionRemote.create(opts ?? {})) as { sessionId?: unknown } | undefined;
    if (typeof result?.sessionId !== "string") {
      throw new Error(`[sessions] session/create 的响应不符合契约：${JSON.stringify(result)}`);
    }
    return SessionId(result.sessionId);
  }

  /** 重新读一个会话的投影（本装配的宿主没有投影面：保持空动作，别把「没实现」当成失败）。 */
  async refreshProjections(
    _sessionId: Parameters<SessionController["refreshProjections"]>[0],
  ): ReturnType<SessionController["refreshProjections"]> {
    return undefined;
  }

  /**
   * 从 Host 拉一次会话列表（走契约方法，不碰上游形态）。
   * @returns 拉取结果（本装配里宿主没挂这一组时是 `undefined`）。
   */
  /**
   * 接上推送与首帧刷新：`api-session/*` 的五个频道把变化写回 store。
   *
   * 宿主没挂 `remote.session` 时（`list()` 返回 `undefined`）推送也不会来——保持空态即可。
   */
  async onInit(ctx: Context): Promise<void> {
    this.context = ctx;
    this.remote.$on("api-session/added", (summary: never) => { this.upsert(summary); });
    this.remote.$on("api-session/removed", (id: never) => { this.remove(id); });
    this.remote.$on("api-session/status", (id: never, running: never) => { this.markStatus(id, running); });
    this.remote.$on("api-session/activity", (id: never, updatedAt: never) => {
      this.markUpdatedAt(id, updatedAt);
    });
    // `error` 目前没有落点：`SessionSummary` 上不带错误字段，上游客户端把它交给 toast/状态层。
    // 这里仍然订阅——频道清单要与上游的 5 条一致；载荷的消费方在 UI 那一层接。
    this.remote.$on("api-session/error", () => {});
    // 读目录要等 descriptor 就位：否则 `remote.session` 还不存在，调用会被静默吞掉。
    //
    // **必须 await**：上游 `ui-workspace` 的 `restoreSelection` 是被 store 变化触发的，它假定
    // 「启动时列表已就绪」。若这里 `void refresh()`，装配完成时 `list.phase` 仍是 `loading`、`ids` 为空，
    // `createInWorkspace` 找不到可复用的 blank，就会 `createNamed({ workspaceId })` 新建一个——
    // 表现是每次 reload 多一个会话，并且那个新会话立刻成为 main（`data-phase="active"` 而不是 hero）。
    await this.remote.whenMounted();
    await this.refresh();
  }

  /** 一条 `added` 推送 → 写回 store（`ids` 保持到达顺序）。 */
  private upsert(summary: { id?: string }): void {
    const id = summary.id;
    if (id === undefined) return;
    const snapshot = this.store.getSnapshot();
    this.store.set({
      ids: snapshot.ids.includes(id) ? snapshot.ids : [...snapshot.ids, id],
      byId: { ...snapshot.byId, [id]: summary },
    });
    this.bindingRefreshers.get(id)?.();
  }

  /**
   * 调整一行 `retainedBy[source]` 的计数（`retain` / `release` 的副作用）。
   * @param id - 会话身份。
   * @param source - 引用来源（`mainView` / `sidebarView` / `skillCatalog` …）。
   * @param delta - +1 或 -1。
   */
  private markRetained(id: string, source: string, delta: number): void {
    const snapshot = this.store.getSnapshot();
    const row = snapshot.byId[id] as { retainedBy?: Record<string, number> } | undefined;
    if (row === undefined) return;
    const retainedBy = { ...row.retainedBy };
    const next = Math.max(0, (retainedBy[source] ?? 0) + delta);
    if (next === 0) delete retainedBy[source];
    else retainedBy[source] = next;
    this.store.set({ byId: { ...snapshot.byId, [id]: { ...row, retainedBy } } });
    for (const listener of this.retainInfoListeners.get(id) ?? []) listener();
  }

  /** 一条 `removed` 推送 → 从 store 移除。 */
  private remove(id: string): void {
    const snapshot = this.store.getSnapshot();
    const byId = { ...snapshot.byId };
    delete byId[id];
    this.store.set({ ids: snapshot.ids.filter((x) => x !== id), byId });
  }

  /**
   * 一行从空白变成"有内容"：目录快照里的 `blank` 置 false（侧栏树按它过滤空白行）。
   * @param id - 会话身份。
   */
  private markEngaged(id: string): void {
    const snapshot = this.store.getSnapshot();
    const row = snapshot.byId[id];
    if (row === undefined || (row as { blank?: boolean }).blank === false) return;
    this.store.set({ byId: { ...snapshot.byId, [id]: { ...row, blank: false } } });
    this.bindingRefreshers.get(id)?.();
  }

  /** 一条 `status` 推送 → 合并进那一行。 */
  private markStatus(id: string, running: boolean): void {
    const snapshot = this.store.getSnapshot();
    const row = snapshot.byId[id];
    if (row === undefined) return;
    this.store.set({ byId: { ...snapshot.byId, [id]: { ...row, running } } });
    this.bindingRefreshers.get(id)?.();
  }

  /** 一条 `activity` 推送 → 更新那一行的时间戳（列表按它排序/显示）。 */
  private markUpdatedAt(id: string, updatedAt: number): void {
    const snapshot = this.store.getSnapshot();
    const row = snapshot.byId[id];
    if (row === undefined) return;
    this.store.set({ byId: { ...snapshot.byId, [id]: { ...row, updatedAt } } });
  }

  async refresh(): Promise<void> {
    const result = (await this.sessionRemote.list()) as
      | { ids?: readonly string[]; byId?: Record<string, unknown> }
      | undefined;
    // 宿主没挂 `remote.session` 时结果是 `undefined`：保持空态（`phase: "ready"`）。
    // **不静默**：空目录会让权限 chip 与模型选择器一起失效（它们的写入要 `binding()`），
    // 所以这条必须留痕，否则下一次还是只能看到"点了没反应"。
    if (result === undefined) {
      console.warn("[sessions] session/list 没有返回（`remote.session` 未挂载？）：目录按空处理");
      this.store.set({ ids: [], byId: {}, phase: "ready" });
      return;
    }
    // 形状校验：宿主返回的东西必须能当目录用。不符就把「到底是什么」说出来，
    // 别让调用方在 `Object.xxx(undefined)` 那种无关的报错里猜。
    if (!Array.isArray(result.ids) || typeof result.byId !== "object" || result.byId === null) {
      throw new Error(`[sessions] session/list 的响应形状不符合契约：${JSON.stringify(result)}`);
    }
    const ids = result.ids ?? [];
    // 上游客户端行读 `projectionValues`（`ui-workspace` 的 `createInWorkspace`、`ui-reference` 的标题），
    // 宿主给的是 `projections.values`——在边界摊平一次，别让消费方各自兼容两种形状。
    const byId = Object.fromEntries(
      Object.entries(result.byId ?? {}).map(([id, row]) => [id, withProjectionValues(row)]),
    );
    this.store.set({ ids, byId, phase: "ready" });
    // 目录是侧栏会话树的数据源：行数对不上时，一眼能看出是"没拉到"还是"渲染丢的"。
    console.info(
      `[sessions] session/list：ids=${ids.length}，byId=${Object.keys(byId).length}，blank=${Object.values(byId).filter((row) => (row as { blank?: boolean }).blank === true).length}`,
    );
    const first = Object.values(byId)[0] as { id?: string; title?: string; blank?: boolean; updatedAt?: number } | undefined;
    if (first !== undefined) console.info("[sessions] 首行样本：", JSON.stringify(first).slice(0, 200));
    // 列表刷新后清掉「已经不在列表里」的 binding 缓存：否则下一次 `binding()` 仍会命中旧对象。
    for (const cached of Array.from(this.bindings.keys())) {
      if (!ids.includes(cached)) {
        this.bindings.delete(cached);
        this.bindingRefreshers.delete(cached);
      }
    }
    // 行上的 `blank` / `running` 可能已经变了（宿主刚落的盘）：让已有 binding 重读一次。
    for (const refresh of this.bindingRefreshers.values()) refresh();
  }

  /** 本装配不铸造 `AgentContext`（会话作用域是显式的 `SessionScope`），所以没有可反查的标签。 */
  scopeOf(): undefined {
    return undefined;
  }
}

/**
 * 把宿主行上的 `projections.values` 摊成客户端行读的 `projectionValues`。
 * @param row - `session/list` 返回的一行（`unknown`）。
 * @returns 带 `projectionValues` 的行（没有投影块时原样返回）。
 */
function withProjectionValues(row: unknown): unknown {
  if (typeof row !== "object" || row === null) return row;
  if (!("projections" in row)) return row;
  const projections = row.projections;
  if (typeof projections !== "object" || projections === null || !("values" in projections)) return row;
  const values = projections.values;
  if (typeof values !== "object" || values === null) return row;
  return { ...row, projectionValues: values };
}
