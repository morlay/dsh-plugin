// session 生命周期的事件名符号：类型是字面量，`ctx.on(SESSION_EVENT, …)` 直接按上游 `Events` 的签名收参数，
// 消费方不再手写字符串。
export const SESSION_CREATED = "session/created";

export const SESSION_DISPOSED = "session/disposed";

export const SESSION_EVENT = "session/event";

export const SESSION_FLUSH = "session/flush";
