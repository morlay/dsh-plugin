// 会话域的事件：名字 + 参数表 + 返回类型都收在类里，订阅/发布走 `EventEmitter`。
//
// 为什么要包一层：上游用 `ctx.emit("session/created", …)` / `ctx.on("session/event", …)` 这种字符串
// 形式，拼错要到运行期才发现，payload 形状也没有一个 home。这里的类与上游 `SessionEventMap` **同名同形**，
// 所以订阅我们的事件、与上游的派发是同一个 cordis 事件。
//
// 域内所有订阅会话事件的包都从这里取，不各自再定义一份——`session/flush` 的签名曾经在别的包里写成
// `[SessionId]`（上游派发的是 `Session`），那种分叉只会在运行期露出来。
import type {
  Session,
  SessionEvent,
  SessionEventMap,
  SessionEventType,
} from "@deepseek-ai/dsh-session";

/**
 * 把一条事件的 `type` 与 `data` **成对**换掉。
 *
 * 「`event.type` 与 `event.data` 相配」这件事在联合类型上表达不出来（展开一条联合事件时 `type` 各支冲突，
 * TS 连可比性都不给），所以配对由**调用方**在签名里给出：`T` 与 `SessionEventMap[T]` 一起传。断言只在本
 * 函数内发生一次，比在每个改写点各写一条 `as unknown as` 收口；读路径与编辑编排共用这一处。
 * @param event - 原事件（`seq` / `time` / 信封字段都保留）。
 * @param type - 新类型。
 * @param data - 新类型对应的数据。
 * @returns 换过 type/data 的事件。
 */
export function withEventType<T extends SessionEventType>(
  event: SessionEvent,
  type: T,
  data: SessionEventMap[T],
): SessionEvent<T> {
  return { ...event, type, data } as unknown as SessionEvent<T>;
}
import { EventEmitter } from "@morlay/zephyr";

/** 一个会话进了 store（`announce` 之后派发；监听者抛错会回滚这次挂载）。 */
export class SessionCreated extends EventEmitter<[Session]> {
  constructor() {
    super("session/created");
  }
}

/** 会话日志追加了一条事件（`emit`，不等待）。 */
export class SessionEventAppended extends EventEmitter<[Session, SessionEvent]> {
  constructor() {
    super("session/event");
  }
}

/** 并行耐久检查点：每个监听者都跑、调用方等全部结束，没有瀑布否决。 */
export class SessionFlush extends EventEmitter<[Session], Promise<void> | void> {
  constructor() {
    super("session/flush");
  }
}

/** 会话从 store 上摘下来了（之后的读写都指向已关闭的实例）。 */
export class SessionDisposed extends EventEmitter<[Session]> {
  constructor() {
    super("session/disposed");
  }
}
