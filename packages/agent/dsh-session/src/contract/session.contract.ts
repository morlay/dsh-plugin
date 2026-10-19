// session seam 的契约：令牌就是我们自己的抽象类，按服务语义命名（不做 `XxxContract` 后缀）。
import type { SessionStore as SessionStoreService } from "@deepseek-ai/dsh-session";
import SessionStoreUpstream from "@deepseek-ai/dsh-session";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

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
  /** 上游实现类：契约令牌也能按实例类型找到「非本装配装的上游实例」（测试/混装场景）。 */
  static readonly serviceClass = SessionStoreUpstream;

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
