// HTTP / WebSocket 路由的形状（契约与实现共用）。
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

/** 一条 HTTP 路由（`exact` 路径或 `prefix` 前缀）。 */
export interface WebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

/** 一条 WebSocket 升级路由。 */
export interface WebUpgradeRoute {
  readonly path: string;
  handler(req: IncomingMessage, socket: Duplex, head: Buffer): void | Promise<void>;
}
