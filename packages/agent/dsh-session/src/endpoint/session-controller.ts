// 会话目录的**端点合同**（wire/api 的适配面）：`sessions` 服务的读面。
//
// home 在会话域的端点面：它引用上游 api 层的 `ISessions`，而端点面依赖 api 层是正当的。
// 从对话域搬来的原因：`dsh-workspace` 的 UI 要 `inject` 它，而对话域反向依赖 workspace，
// 直接 import 就是包级环；本文件自包含（引用类型都在文件内或中立面），整文件搬过来最省。
// 令牌名是派生名 `session-controller`，**不能**写成 `sessions`：浏览器树的 `sessions` 由上游
// `ClientSessions` 自己在构造里 `rootCtx.reflect.provide('sessions', this)` 占住（`service.ts`），
// 本行的契约名若也占 `sessions`，cordis 会拒绝（`service "sessions" has been registered at <root>`）。
// 「对齐上游面」在这里靠**令牌身份**：别的域 `inject(SessionController)` 拿到的就是上游 `ClientSessions` 的实例。
//
// 每个成员的**签名**都取上游 `ISessions`（`Parameters` / `ReturnType` / 直接别名），不手抄形状：手抄过的
// `list`（`{ ids, byId }` 对上游 `{ items }`）就是这么漂开的（wire 契约那侧同源的问题见
// `session-endpoint.ts` 的 `SessionPageRequest`）。实现由 `SessionControllerDefault` 组合 `ClientSessions` 提供。
import { Injectable } from "@morlay/zephyr";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";

/**
 * 会话作用域：上游 `AgentContext`（= `ISessions["scope"]` 的返回）。
 *
 * 这里曾经声明成"本装配实供的成员子集"——那是**谎报**：`scope(id)` 交出去的就是上游那个对象
 * （不复制、不包装，否则 `sessionOf` 靠 ctx 上的标签反查会断链）。收窄只会让读 `ctx.sessions.scope(id)`
 * 的消费方看不见成员，所以形状以上游为准。
 */
export type SessionScope = NonNullable<ReturnType<ISessions["scope"]>>;

/**
 * 会话视图：上游 `SessionFace`（= `ISessions["sessionOf"]` 的返回）。
 *
 * 同 {@link SessionScope}：交出去的就是上游那个对象，收窄是谎报。
 */
export type SessionView = NonNullable<ReturnType<ISessions["sessionOf"]>>;

/**
 * 会话目录快照：上游 `SessionListState`（= `ISessions["list"]` 的快照类型）。
 *
 * 这里曾经手抄成 `{ ids, byId, phase: 'loading'|'ready'|'failed' }`（行是 `unknown`）——上游实际是
 * `{ ids: SessionId[], byId: Record<SessionId, SessionSummary>, phase: 'pending'|'ready', projectionsBySession }`。
 * 键齐、形状不同，正是"覆盖守卫只核键"时看不见的那类错。
 */
export type SessionCatalogState = ReturnType<ISessions["list"]["getSnapshot"]>;

/**
 * 会话目录的只读 observable：上游 `ObservableSnapshot<SessionListState>`。
 *
 * 本装配**原样**交出上游那份快照（`ClientSessions.list`），不重映射相位、不重打字行。
 */
export type SessionCatalog = ISessions["list"];

/**
 * 保留句柄：上游 `SessionReference`（= `ISessions["retain"]` 的返回）。
 *
 * 交出去的就是上游那个对象：`release()` 幂等，`binding` 是惰性 getter（释放后抛）。曾经另造过一个
 * `{ release, dispose, binding: unknown }` 的包装——包装让上游的 `using` 语义（`[Symbol.dispose]`）落空，
 * 也把 `binding` 的类型抹成 `unknown`。
 */
export type SessionRetainHandle = ReturnType<ISessions["retain"]>;

@Injectable()
export abstract class SessionController implements ISessions {
  abstract readonly list: ISessions["list"];

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

  /** 从一个 cordis 上下文反查它所属会话（入参就是上游要的 cordis `Context`）。 */
  abstract scopeOf(ctx: Parameters<ISessions["scopeOf"]>[0]): ReturnType<ISessions["scopeOf"]>;

  /** 重新读一个会话的投影（宿主拒绝复用 blank 时，UI 会刷新那一行）。 */
  abstract refreshProjections(
    sessionId: Parameters<ISessions["refreshProjections"]>[0],
  ): ReturnType<ISessions["refreshProjections"]>;

  /** 一个会话的作用域（`ui-input-trigger` 用它把 sessionId 换成 controller 的 ctx）。 */
  abstract scope(id: Parameters<ISessions["scope"]>[0]): ReturnType<ISessions["scope"]>;

  /** 从一个作用域反查会话面（输入区触发器用它）。 */
  abstract sessionOf(
    ctx: Parameters<ISessions["sessionOf"]>[0],
  ): ReturnType<ISessions["sessionOf"]>;

  /** 取一个会话实例（宿主侧的 `ctx.sessions.get(id)`；客户端侧给空）。 */
  abstract get(id: string): ReturnType<ISessions["binding"]>;

  /** 一行的当前 binding（上游 `ui-session` 用它比对保留者）。 */
  abstract binding(id: string): ReturnType<ISessions["binding"]>;

  /** 某一行的保留信息（上游 `ui-session` 的 `watchMainRetention` 订阅它）。 */
  abstract retainInfo(id: string): ReturnType<ISessions["retainInfo"]>;

  abstract retain(
    target: Parameters<ISessions["retain"]>[0],
    options: Parameters<ISessions["retain"]>[1],
  ): ReturnType<ISessions["retain"]>;

  abstract using<T>(
    target: Parameters<ISessions["using"]>[0],
    options: Parameters<ISessions["using"]>[1],
    operation: (reference: SessionRetainHandle) => T | Promise<T>,
  ): Promise<T>;
}
