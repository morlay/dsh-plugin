// session-query seam 的契约：令牌按服务语义命名（上游注册名 `sessionQuery`）。
import type { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";
import { Injectable } from "@morlay/zephyr";

interface SessionQueryFace {
  readonly observeSession: SessionQueryEngine["observeSession"];
  readonly searchSessions: SessionQueryEngine["searchSessions"];
  readonly searchEvents: SessionQueryEngine["searchEvents"];
  readonly listSessions: SessionQueryEngine["listSessions"];
}

/** 会话查询：浏览 / 搜索 / 列表。 */
@Injectable()
export abstract class SessionQuery implements SessionQueryFace {
  abstract readonly observeSession: SessionQueryFace["observeSession"];

  abstract readonly searchSessions: SessionQueryFace["searchSessions"];

  abstract readonly searchEvents: SessionQueryFace["searchEvents"];

  abstract readonly listSessions: SessionQueryFace["listSessions"];
}
