// HTTP / WebSocket 路由的形状（契约与实现共用）。
import type { PeerScope } from "@deepseek-ai/dsh-client-connection";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

/** 一条 HTTP 路由（`exact` 路径或 `prefix` 前缀）。 */
export interface WebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  /**
   * 准入（上游 0.2.3）：`required` 表示这条路由要 owner Peer——派发前走 `Connection.admit`，
   * 被拒就回 rejection，通过就把这次请求代表的 peer 交给 handler。
   */
  readonly auth?: "required" | "none";
  handler(req: IncomingMessage, res: ServerResponse, peer?: PeerScope): void | Promise<void>;
}

/** 一条 WebSocket 升级路由。 */
export interface WebUpgradeRoute {
  readonly path: string;
  handler(req: IncomingMessage, socket: Duplex, head: Buffer): void | Promise<void>;
}
