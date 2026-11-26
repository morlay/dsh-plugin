// 客户端侧的作用域解析：**会话域**知道 id ↔ 作用域，wire 只认 id（框架契约 `ClientScopeResolver`）。
//
// 为什么必须有：转发的请求（审批、用户提问）到浏览器只剩 `agentId`，而 listener 要靠
// `sessions.scopeOf(this)` 认出会话——解析不出来就直接 `next()`，用户看到的是一张卡都不弹。
//
// 本行实现框架契约 `ClientScopeResolver`，由 `Remote` **按名字晚绑定**读取：写成注入会成环
// （本行依赖 `SessionController`，而它依赖 `Remote`），环上的 fiber 永远停在 pending。
import { inject, Injectable } from "@morlay/zephyr";
import { ClientScopeResolver } from "@morlay/zephyr-app/client";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionController } from "@morlay/dsh-conversation/contract";

@Injectable()
export class AgentScopesDefault extends ClientScopeResolver {
  private readonly sessions = inject(SessionController);

  resolve(agentId: string): object | undefined {
    return this.sessions.scope(SessionId(agentId));
  }
}
