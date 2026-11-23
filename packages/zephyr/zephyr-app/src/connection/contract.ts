// 宿主侧的 `connection` 面（上游 `HostConnectionService`，服务名 `connection`）。
//
// 成员就是宿主消费方要的那几面：共享 RPC 通道的注册面、exact fetch 路由表、`/api` 前缀的共享分派器、
// 准入（upgrade 与 `/api` 前缀共用同一次判定）、进程内 owner peer。
//
// 浏览器消费面不在这里（`ClientConnection`）：0.2.2 上游这两个面是同一个类，本仓也就只抄了一个契约；
// 0.2.3 上游拆成两个类，契约跟着各是各的。
import type {
  ConnectionFetchHandler,
  ConnectionTrustRequest,
  HostConnectionFetch,
  HostConnectionRpc,
  PeerAdmission,
  PeerScope,
} from "@deepseek-ai/dsh-client-connection";
import { Injectable } from "@morlay/zephyr";

interface ConnectionFace {
  /** 共享 RPC 通道的注册面（`intercept` 一条通道只容一个物理拦截器）。 */
  readonly rpc: HostConnectionRpc;
  /** exact fetch 路由表（上游 `ui-deliverables` 之类往这里注册 HTTP 路由）。 */
  readonly fetch: HostConnectionFetch;
  /** `/api` 前缀的共享分派器：exact 路由优先，其次 rpc 拦截器，都没有时 404。 */
  createSharedFetchHandler(channel: "/api"): ConnectionFetchHandler;
  /** 准入与信任围栏：upgrade 与 `/api` 前缀共用同一次判定（拿到的 peer 是同一个实例）。 */
  admit(request: ConnectionTrustRequest): PeerAdmission;
  /** 进程内可信调用方共享的 owner peer。 */
  readonly browserPeer: PeerScope;
}

@Injectable()
export abstract class Connection implements ConnectionFace {
  abstract readonly rpc: ConnectionFace["rpc"];

  abstract readonly fetch: ConnectionFace["fetch"];

  abstract createSharedFetchHandler(
    channel: "/api",
  ): ReturnType<ConnectionFace["createSharedFetchHandler"]>;

  abstract admit(request: ConnectionTrustRequest): ReturnType<ConnectionFace["admit"]>;

  abstract readonly browserPeer: ConnectionFace["browserPeer"];
}
