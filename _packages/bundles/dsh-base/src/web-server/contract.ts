// 服务端 HTTP 宿主契约：令牌按服务语义命名（上游注册名 `webServer`）。
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { Injectable } from "@morlay/zephyr";

/** 一条 HTTP 路由（`single` 前缀或 `exact` 路径）。 */
export interface WebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

/** 一条 WebSocket 升级路由。 */
export interface WebUpgradeRoute {
  readonly path: string;
  handler(req: IncomingMessage, socket: unknown, head: unknown): void | Promise<void>;
}

interface WebServerFace {
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
  readonly server: Server | undefined;
  readonly register: (route: WebRoute) => () => void;
  readonly registerUpgrade: (route: WebUpgradeRoute) => () => void;
  readonly registerFallback: (
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ) => () => void;
}

@Injectable()
export abstract class WebServer implements WebServerFace {
  abstract readonly host: WebServerFace["host"];

  abstract readonly port: WebServerFace["port"];

  abstract readonly protocol: WebServerFace["protocol"];

  abstract readonly server: WebServerFace["server"];

  abstract readonly register: WebServerFace["register"];

  abstract readonly registerUpgrade: WebServerFace["registerUpgrade"];

  abstract readonly registerFallback: WebServerFace["registerFallback"];
}
