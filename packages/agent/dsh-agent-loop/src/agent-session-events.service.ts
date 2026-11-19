// agent 的**会话事件补发**：把 `session/event` 定向派发到该会话所属 agent 的 scope 上。
//
// 为什么需要：上游的「上次送过的注入没变就不重发」判据监听在 **agent scope** 上
// （`agent-loop/src/runtime-context.ts` 的 `RuntimeContextProjection`），而 `session/event` 由会话存储
// （本仓的 `provideSession()` 是根上的一行）发出。cordis 的事件**只向上流**：根上 emit 的事件到不了
// 子 scope 的监听器，那条判据于是永远不成立——每个请求都追加一整条同样的 `<system-reminder>`
// （`packages/agent/.agents/designs/20261119-会话事件补发到agent-scope.md`）。
//
// 为什么必须**定向**：`ctx.emit` 会触发该 ctx 及其祖先上的监听器，直接在 agent scope 上 emit 会让根上的
// 监听器（持久化、投影缓存）再收一次——那是双写。这里用上游 `scopeTarget` 的同一个过滤符号构造 carrier，
// 只放行「scope 正是这个 agent」的监听器。
//
// 前提（本仓的装配事实）：会话存储是根上的一行。若哪天它变成 agent-scoped，这条补发会与上游自己的派发
// 重复——那时应当删掉本行（判据见上面那份债记录里的两条用例）。
import { inject, Injectable, Logger, type Context, type OnInit } from "@morlay/zephyr";
import { scopeOf, scopeTarget, type Agent } from "@morlay/dsh-agent/contract";

/** 上游 `events.dispatch` 解析出来的一条监听器（已绑定它的 `this`）。 */
type SessionListener = (session: object, event: unknown) => unknown;

/** agent scope 的 ctx：本仓只用到「按过滤符号解析监听器」与「scope 卸载时收尾」这两面。 */
interface ScopeCtx {
  readonly events: { dispatch(type: string, args: readonly unknown[]): readonly SessionListener[] };
  effect(callback: () => () => void): unknown;
}

/** 一个 agent 的派发目标：它的 scope key 与 `events` 面。 */
interface Target {
  readonly events: ScopeCtx["events"];
  readonly key: unknown;
}

/**
 * cordis 的监听器过滤符号（`Symbol.for('cordis.filter')`）。
 *
 * 本仓没有对 cordis 的运行期依赖，所以**不 import 它**：从上游自己的 carrier 上取一次
 * （`scopeTarget` 的产物恰好带这个符号）。取不到就整条不装——宁可保留上游行为，也不双触发。
 */
const FILTER = Object.getOwnPropertySymbols(scopeTarget({} as object, undefined))[0];

@Injectable()
export class AgentSessionEvents implements OnInit {
  private readonly logger = inject.optional(Logger);

  /** 会话 → 它的 agent 的派发目标（会话对象在 agent 卸载后可能还活着，所以按会话登记）。 */
  private readonly targets = new WeakMap<object, Target>();

  onInit(ctx: Context): void {
    if (FILTER === undefined) {
      this.logger?.warn(
        "agent-loop: 取不到 cordis 的监听器过滤符号，会话事件不补发到 agent scope（注入会每步重发）",
      );
      return;
    }
    ctx.on("agent/created", (payload: { readonly agent: Agent }) => {
      const agent = payload.agent;
      // 边界桥：另一头是 cordis 的 Context（`events` / `effect` 不在本仓的 `Context` 面上）。
      const scopeCtx = agent.ctx as unknown as ScopeCtx;
      this.targets.set(agent.session, { events: scopeCtx.events, key: scopeOf(agent.ctx) });
      // agent scope 卸载时摘掉这条映射（会话对象可能比它活得久）。
      scopeCtx.effect(() => () => {
        this.targets.delete(agent.session);
      });
    });
    // 事件的参数在本仓的 `Events` 面里没有收窄（上游把 `session` 声明成 `Scoped<Session>`），
    // 这里按实际形状收一次：它是会话对象本身。
    ctx.on("session/event", (session: unknown, event: unknown) => {
      if (typeof session !== "object" || session === null) return;
      const target = this.targets.get(session);
      if (target === undefined) return;
      const carrier = {
        [FILTER]: (hookCtx: unknown) => scopeOf(hookCtx as never) === target.key,
      };
      // `dispatch` 只解析监听器，调用归调用方（与上游 `collectSessionCallbacks` 同一手法）。
      for (const listener of target.events.dispatch("emit", [
        carrier,
        "session/event",
        session,
        event,
      ])) {
        listener(session, event);
      }
    });
  }
}
