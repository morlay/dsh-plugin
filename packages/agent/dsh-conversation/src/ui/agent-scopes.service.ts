// 客户端侧的 agent 作用域解析：**会话域**知道 id ↔ 作用域，wire 只认 id。
//
// 为什么必须有：转发的请求（审批、用户提问）到浏览器只剩 `agentId`，而 listener 要靠
// `sessions.scopeOf(this)` 认出会话——解析不出来就直接 `next()`，用户看到的是一张卡都不弹。
import { inject, Injectable } from "@morlay/zephyr";
import { ClientAgentScopes } from "@morlay/zephyr-app/client";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionController } from "@morlay/dsh-conversation/contract";

@Injectable()
export class AgentScopesDefault extends ClientAgentScopes {
  private readonly sessions = inject(SessionController);

  scopeOf(agentId: string): object | undefined {
    return this.sessions.scope(SessionId(agentId));
  }
}
