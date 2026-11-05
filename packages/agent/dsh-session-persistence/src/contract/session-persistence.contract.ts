// 会话持久化契约：令牌按服务语义命名（上游注册名 `sessionPersistence`）。
//
// 上游那个同名类是 cordis `Service`（构造即注册），不能直接当我们的契约用——这里取它的**公开面**，
// 实现由适配行或本包的手写实现提供。
import type { SessionPersistence as UpstreamPersistence } from "@deepseek-ai/dsh-session-persistence";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

// 能力词汇：句柄的读写面、落盘快照与它们的坐标。上游把契约与默认实现（jsonl）放在一个包里，
// 这里只转出**词汇**——替换实现（RDB / 别的后端）要实现的就是这些形状。
/** 一次读操作的产出：header、继承前缀长度与事件。 */
export type { SessionPersistenceSnapshot } from "@deepseek-ai/dsh-session-persistence";
/** 后端自报的存储元信息（后端名、路径、库身份这类给管理面看的东西）。 */
export type { SessionStorageMetadata } from "@deepseek-ai/dsh-session-persistence";
/** 一份打开着的会话句柄（读 / 写 / flush / close）。 */
export type { SessionHandle } from "@deepseek-ai/dsh-session-persistence";
/** 一次落盘修订号：append 之后变，用来判断「这份快照还新不新」（品牌类型 + 同名铸造函数，按值转出）。 */
export { SessionPersistenceRevision } from "@deepseek-ai/dsh-session-persistence";
/** 读盘时的词汇校验：未知事件类型要显式失败，而不是当空日志（纯函数）。 */
export { validateStoredEvents } from "@deepseek-ai/dsh-session-persistence";

/**
 * 契约面：上游 `SessionPersistence` 的**全部**公开成员。
 *
 * `identity` 是实例身份（进程内稳定、服务被替换后不同），上游按它判断「同一份后端」；
 * 其余五个是读写入口。下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
@Injectable({ name: "sessionPersistence" })
export abstract class SessionPersistence {
  /** 实例身份：进程内稳定、服务被替换后不同（上游按它判断「同一份后端」）。 */
  abstract readonly identity: UpstreamPersistence["identity"];

  abstract create(
    header: Parameters<UpstreamPersistence["create"]>[0],
    options?: Parameters<UpstreamPersistence["create"]>[1],
  ): ReturnType<UpstreamPersistence["create"]>;

  abstract open(
    id: Parameters<UpstreamPersistence["open"]>[0],
    access: Parameters<UpstreamPersistence["open"]>[1],
    options?: Parameters<UpstreamPersistence["open"]>[2],
  ): ReturnType<UpstreamPersistence["open"]>;

  abstract flush(): ReturnType<UpstreamPersistence["flush"]>;

  abstract stat(
    id: Parameters<UpstreamPersistence["stat"]>[0],
    options?: Parameters<UpstreamPersistence["stat"]>[1],
  ): ReturnType<UpstreamPersistence["stat"]>;

  abstract list(
    options?: Parameters<UpstreamPersistence["list"]>[0],
  ): ReturnType<UpstreamPersistence["list"]>;
}

/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionPersistenceCovered = AssertTrue<
  AssertCovered<UpstreamPersistence, SessionPersistence>
>;
