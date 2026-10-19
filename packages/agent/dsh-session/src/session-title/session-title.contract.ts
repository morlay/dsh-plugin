// session-title seam 的契约：令牌按服务语义命名（上游注册名 `sessionTitle`）。
import type SessionTitleService from "@deepseek-ai/dsh-session-title";
import { Injectable } from "@morlay/zephyr";

interface SessionTitleFace {
  readonly get: SessionTitleService["get"];
  readonly rename: SessionTitleService["rename"];
}

/** 会话标题：读取与重命名。 */
@Injectable()
export abstract class SessionTitle implements SessionTitleFace {
  abstract readonly get: SessionTitleFace["get"];

  abstract readonly rename: SessionTitleFace["rename"];
}
