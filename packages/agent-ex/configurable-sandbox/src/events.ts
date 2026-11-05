// 本包订阅的上游事件：名字与参数表收在类里（拼错名字或参数表在编译期就报）。
//
// 与上游同名即可互通——上游用 `ctx.emit("agent/created", …)` 派发，这里用同一套名字订阅。
import type { Agent } from "@morlay/dsh-agent/contract";
import { EventEmitter } from "@morlay/zephyr";

// 会话建好了（晚于它的 preset 行挂载，早于第一次装配）。
export class AgentCreated extends EventEmitter<[{ readonly agent: Agent }]> {
  constructor() {
    super("agent/created");
  }
}
