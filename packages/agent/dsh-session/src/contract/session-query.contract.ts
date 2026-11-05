// session-query seam 的契约：令牌按服务语义命名（上游注册名 `sessionQuery`）。
import type { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SessionQueryEngine` 的**全部**公开成员（浏览 / 搜索 / 列表 / 读取）。
 *
 * 成员一个都不能少——上游插件按 `ctx.sessionQuery.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionQueryCovered = AssertTrue<
  AssertCovered<SessionQueryEngine, SessionQuery>
>;

/** 会话查询：浏览 / 搜索 / 列表 / 读取。 */
@Injectable()
export abstract class SessionQuery {
  abstract readonly observeSession: SessionQueryEngine["observeSession"];

  abstract readonly searchSessions: SessionQueryEngine["searchSessions"];

  abstract readonly searchEvents: SessionQueryEngine["searchEvents"];

  abstract readonly listSessions: SessionQueryEngine["listSessions"];

  abstract readonly readSession: SessionQueryEngine["readSession"];

  abstract readonly filterSessions: SessionQueryEngine["filterSessions"];

  abstract readonly readTitle: SessionQueryEngine["readTitle"];

  abstract readonly readTitleSnapshot: SessionQueryEngine["readTitleSnapshot"];

  abstract readonly readTitleSnapshots: SessionQueryEngine["readTitleSnapshots"];

  abstract readonly listEvents: SessionQueryEngine["listEvents"];

  abstract readonly filterEvents: SessionQueryEngine["filterEvents"];

  abstract readonly readSurface: SessionQueryEngine["readSurface"];

  abstract readonly traceSession: SessionQueryEngine["traceSession"];

  abstract readonly traceEvent: SessionQueryEngine["traceEvent"];

  abstract readonly readEvent: SessionQueryEngine["readEvent"];
}

