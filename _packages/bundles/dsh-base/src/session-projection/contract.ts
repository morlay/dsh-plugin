// session-projection seam 的契约：令牌按服务语义命名（上游注册名 `sessionProjections`）。
import type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable } from "@morlay/zephyr";

interface SessionProjectionsFace {
  readonly register: SessionProjectionRegistry["register"];
}

/** 投影注册表：按会话状态键登记投影。 */
@Injectable()
export abstract class SessionProjections implements SessionProjectionsFace {
  abstract readonly register: SessionProjectionsFace["register"];
}
