// 「agent 域忙不忙」：有任一 agent 开着 turn 就是忙。
//
// 换树会让在途的东西半路换手：turn 开着时模型调用还在等 provider，换树之后它握着的是旧行的实例。
// 判据只读注册表自己的事实（`turnBoundaryOf(...).openTurnStartSeq`），不看会话里的消息内容。
import { Injectable, inject } from "@morlay/zephyr";
import { IdleGuard } from "@morlay/zephyr-app";
import { AgentDirectory } from "./contract/agent-directory.contract.ts";

@Injectable({ multi: true })
export class AgentIdleGuard extends IdleGuard {
  private readonly agents = inject(AgentDirectory);

  /**
   * @returns 没有开着的 turn 就是空闲。
   */
  isIdle(): boolean {
    return this.agents
      .list()
      .every((agent) => this.agents.turnBoundaryOf(agent.session).openTurnStartSeq === null);
  }
}
