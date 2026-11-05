// 会话域的事件：名字 + 参数表 + 返回类型都收在类里，订阅/发布走 `EventEmitter`。
//
// 为什么要包一层：上游用 `ctx.emit("session/flush")` / `ctx.on("session/flush", …)` 这种字符串形式，
// 拼错要到运行期才发现，payload 形状也没有一个 home。这里的类与上游**同名**，
// 所以订阅我们的事件、与上游的派发是同一个 cordis 事件。
import { EventEmitter } from "@morlay/zephyr";
import { SessionId } from "./endpoint/session-id.ts";

export class SessionFlush extends EventEmitter<[SessionId]> {
  constructor() {
    super("session/flush");
  }
}
