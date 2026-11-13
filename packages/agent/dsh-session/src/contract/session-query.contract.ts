// session-query seam 的契约：令牌按服务语义命名（上游注册名 `sessionQuery`）。
import type { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";

// 上游查询面的**值与类型**从这里转出：消费方（本仓的包）只引 `@morlay/dsh-session`，
// 不直接引 `@deepseek-ai/dsh-session-query`（同 `@morlay/dsh-storage` 转出 storage-domain 的门面口径）。
export { SessionQueryEngine, SessionQueryError } from "@deepseek-ai/dsh-session-query";
export type {
  SessionEventReadRequest,
  SessionEventTraceObservation,
  SessionObservation,
  SessionObservationOptions,
  SessionResultRange,
  SessionSearchHit,
  SessionSearchPage,
  SessionEventRecord,
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionEventSearchPage,
  SessionEventWindow,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionRecord,
  SessionResultFilter,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from "@deepseek-ai/dsh-session-query";

// 查询面的**纯函数与常量**：构建记录 / 搜索文档、过滤、物化分页窗口。
// 消费方（RDB 查询实现、导出面）要用它们，跟类型一起从这里出。
export {
  SESSION_QUERY_READ_WINDOW_MAX,
  buildSessionEventRecords,
  buildSessionEventSearchDocuments,
  extractSessionEventText,
  filterSessionEventDocuments,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from "@deepseek-ai/dsh-session-query";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/**
 * 契约面：上游 `SessionQueryEngine` 的**全部**公开成员（浏览 / 搜索 / 列表 / 读取）。
 *
 * 成员一个都不能少——上游插件按 `ctx.sessionQuery.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionQueryCovered = AssertTrue<AssertCovered<SessionQueryEngine, SessionQuery>>;

/**
 * 会话查询：浏览 / 搜索 / 列表 / 读取。
 *
 * `@Injectable({ name: "sessionQuery" })` 是**上游名别名**：装配期与派生名 `session-query` **并存**
 * 发布同一个实例（`bootstrap.ts` 的别名发布），不是第二份实现。必须叫这个名字，是因为上游有六个读者
 * 按驼峰名读 `this.ctx.sessionQuery`（`SessionReferenceResolver`、`SessionController` 与它的
 * history / skill-catalog、`SubagentManager`、`ui-deliverables` …）；而经 wire（typert gateway）分派时，
 * cordis 会用**调用方**的 ctx 重建服务的 `this.ctx`（`createTraceable`），上游名只在 root store 里查：
 * 少了它就读到 `undefined`（症状：`sessionReferenceResolver/candidates` 抛
 * `Cannot read properties of undefined (reading 'listSessions')`）。
 *
 * 实现有两份，都在本仓库里，装配面选一份：
 * - `packages/agent/dsh-session` 的 `SessionQuerySqlite`——上游 `session-query-sqlite` engine 的适配行（默认）；
 * - `packages/agent-ex/better-session` 的 `SessionQueryRdb`——直读 RDB 的替换实现。
 *
 * 装配面用一句 `without(SessionQuerySqlite)` 选后者（`apps/zephyr-custom/src/zephyr.provide.ts`）。
 * 这两个名字（`session-query` / `sessionQuery`）指向**同一个实例**，不是两份实现；
 * 别名只在名字**没被占**时发布（`bootstrap.ts`：`store.get(meta.alias, false) === undefined`），
 * 所以漏写那句 `without` 时装配会当场抛 `service "sessionQuery" has been registered`——
 * 这正是 `apps/zephyr-custom/src/__tests__/assembly.spec.ts` 的「替换面各只有一份实例」在守的东西。
 */
@Injectable({ name: "sessionQuery" })
export abstract class SessionQuery {
  abstract observeSession(
    ...args: Parameters<SessionQueryEngine["observeSession"]>
  ): ReturnType<SessionQueryEngine["observeSession"]>;

  abstract searchSessions(
    ...args: Parameters<SessionQueryEngine["searchSessions"]>
  ): ReturnType<SessionQueryEngine["searchSessions"]>;

  abstract searchEvents(
    ...args: Parameters<SessionQueryEngine["searchEvents"]>
  ): ReturnType<SessionQueryEngine["searchEvents"]>;

  abstract listSessions(
    ...args: Parameters<SessionQueryEngine["listSessions"]>
  ): ReturnType<SessionQueryEngine["listSessions"]>;

  abstract readSession(
    ...args: Parameters<SessionQueryEngine["readSession"]>
  ): ReturnType<SessionQueryEngine["readSession"]>;

  abstract filterSessions(
    ...args: Parameters<SessionQueryEngine["filterSessions"]>
  ): ReturnType<SessionQueryEngine["filterSessions"]>;

  abstract readTitle(
    ...args: Parameters<SessionQueryEngine["readTitle"]>
  ): ReturnType<SessionQueryEngine["readTitle"]>;

  abstract readTitleSnapshot(
    ...args: Parameters<SessionQueryEngine["readTitleSnapshot"]>
  ): ReturnType<SessionQueryEngine["readTitleSnapshot"]>;

  abstract readTitleSnapshots(
    ...args: Parameters<SessionQueryEngine["readTitleSnapshots"]>
  ): ReturnType<SessionQueryEngine["readTitleSnapshots"]>;

  abstract listEvents(
    ...args: Parameters<SessionQueryEngine["listEvents"]>
  ): ReturnType<SessionQueryEngine["listEvents"]>;

  abstract filterEvents(
    ...args: Parameters<SessionQueryEngine["filterEvents"]>
  ): ReturnType<SessionQueryEngine["filterEvents"]>;

  abstract readSurface(
    ...args: Parameters<SessionQueryEngine["readSurface"]>
  ): ReturnType<SessionQueryEngine["readSurface"]>;

  abstract traceSession(
    ...args: Parameters<SessionQueryEngine["traceSession"]>
  ): ReturnType<SessionQueryEngine["traceSession"]>;

  abstract traceEvent(
    ...args: Parameters<SessionQueryEngine["traceEvent"]>
  ): ReturnType<SessionQueryEngine["traceEvent"]>;

  abstract readEvent(
    ...args: Parameters<SessionQueryEngine["readEvent"]>
  ): ReturnType<SessionQueryEngine["readEvent"]>;

  abstract inspectSession: SessionQueryEngine["inspectSession"];
}
