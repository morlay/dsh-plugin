// 会话持久化契约：令牌按服务语义命名（上游注册名 `sessionPersistence`）。
//
// 上游那个同名类是 cordis `Service`（构造即注册），不能直接当我们的契约用——这里取它的**公开面**，
// 实现由适配行或本包的手写实现提供。
import type { SessionPersistence as UpstreamPersistence } from "@deepseek-ai/dsh-session-persistence";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SessionPersistence` 的**全部**公开成员。
 *
 * `identity` 是实例身份（进程内稳定、服务被替换后不同），上游按它判断「同一份后端」；
 * 其余五个是读写入口。下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
@Injectable()
export abstract class SessionPersistence {
  /**
   * 上游注册名：上游插件按 `ctx.get('sessionPersistence')` / `ctx.sessionPersistence` 读这个可选后端
   * （`api-session` 的 resume 就是），而名字视图按它建条目。少了它，那边读到的就是 `undefined`
   * （症状：`cannot resume: session persistence is not configured`）。
   */
  static readonly serviceName = "sessionPersistence";

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

  abstract list(options?: Parameters<UpstreamPersistence["list"]>[0]): ReturnType<UpstreamPersistence["list"]>;
}

/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionPersistenceCovered = AssertTrue<
  AssertCovered<UpstreamPersistence, SessionPersistence>
>;
