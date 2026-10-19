// session seam 的契约：令牌就是我们自己的抽象类，按服务语义命名（不做 `XxxContract` 后缀）。
import type { SessionStore as SessionStoreService } from "@deepseek-ai/dsh-session";
import SessionStoreUpstream from "@deepseek-ai/dsh-session";
import { Injectable } from "@morlay/zephyr";

/** 会话存储的公开面（服务基类的 ctx / fiber 不在契约里）。 */
interface SessionFace {
  readonly create: SessionStoreService["create"];
  readonly prepare: SessionStoreService["prepare"];
  readonly get: SessionStoreService["get"];
  readonly list: SessionStoreService["list"];
  readonly fork: SessionStoreService["fork"];
  readonly flush: SessionStoreService["flush"];
}

/** 会话存储：建立 / 读取 / 分叉 / 落盘。 */
@Injectable()
export abstract class SessionStore implements SessionFace {
  /** 上游实现类：契约令牌也能按实例类型找到「非本装配装的上游实例」（测试/混装场景）。 */
  static readonly serviceClass = SessionStoreUpstream;

  abstract readonly create: SessionFace["create"];

  abstract readonly prepare: SessionFace["prepare"];

  abstract readonly get: SessionFace["get"];

  abstract readonly list: SessionFace["list"];

  abstract readonly fork: SessionFace["fork"];

  abstract readonly flush: SessionFace["flush"];
}
