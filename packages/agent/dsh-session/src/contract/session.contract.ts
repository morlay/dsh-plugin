// session seam 的契约：令牌就是我们自己的抽象类，按服务语义命名（不做 `XxxContract` 后缀）。
import type { SessionStore as SessionStoreService } from "@deepseek-ai/dsh-session";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

// 能力词汇：会话日志本身（会话对象、事件与 header、它们的身份与坐标）。上游按 `@deepseek-ai/dsh-session`
// 的包根与 `/types` 两个入口散着出，这里按「一份会话日志」归成一处：扩展/替换实现只引它，不引上游。
/** 一份会话：内存里的日志与它的 header。按**值**转出：消费方要用 `Session.create(...)` 造只读视图。 */
export { Session } from "@deepseek-ai/dsh-session";
/** 一条会话事件（按 `type` 收窄的联合）。 */
export type { SessionEvent } from "@deepseek-ai/dsh-session";
/** 会话 header：身份、格式版本、cwd、父会话与种子水位。 */
export type { SessionHeader } from "@deepseek-ai/dsh-session";
/** 事件坐标的游标：既可以是 seq，也可以是 `-1`（空日志的起点）。 */
export type { SessionSeqCursor } from "@deepseek-ai/dsh-session";
/** 表层操作（append / replace）：事件在「模型看得见的表层」上做什么。 */
export type { SurfaceOp } from "@deepseek-ai/dsh-session";
/** agent 取消的原因（用户取消 / 超时 …）。 */
export type { AgentCancelCause } from "@deepseek-ai/dsh-session";
/** 会话身份：品牌类型与同名铸造函数（两用，所以按值转出）。 */
export { SessionId } from "@deepseek-ai/dsh-session";
/** 事件序号：品牌数字与同名铸造函数（两用，所以按值转出）。 */
export { SessionSeq } from "@deepseek-ai/dsh-session";
/** 种子前缀长度：品牌数字与同名铸造函数（两用，所以按值转出）。 */
export { SessionLogOffset } from "@deepseek-ai/dsh-session";
/** 会话格式版本号：读出旧日志时按它判断要不要迁移。 */
export { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";

/**
 * 契约面：上游 `SessionStore` 的**全部**公开成员（建立 / 读取 / 分叉 / 落盘 / 投影登记）。
 *
 * 成员一个都不能少——上游插件按 `ctx.sessions.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionStoreCovered = AssertTrue<AssertCovered<SessionStoreService, SessionStore>>;

/** 会话存储：建立 / 读取 / 分叉 / 落盘。 */
@Injectable()
export abstract class SessionStore {
  abstract readonly create: SessionStoreService["create"];

  abstract readonly prepare: SessionStoreService["prepare"];

  abstract readonly get: SessionStoreService["get"];

  abstract readonly list: SessionStoreService["list"];

  abstract readonly fork: SessionStoreService["fork"];

  abstract readonly flush: SessionStoreService["flush"];

  abstract readonly messageProjections: SessionStoreService["messageProjections"];

  abstract readonly registerMessageProjection: SessionStoreService["registerMessageProjection"];

  abstract readonly enter: SessionStoreService["enter"];

  abstract readonly announce: SessionStoreService["announce"];
}
