// 服务端 HTTP 宿主契约：令牌按服务语义命名（上游注册名 `webServer`）。
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute, WebUpgradeRoute } from "./route.types.ts";
import type { Duplex } from "node:stream";
import { Injectable } from "@morlay/zephyr";

interface WebServerFace {
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
  /** 底层 http server（`listen`/`close`/`on("upgrade")` 可用；不限定实现）。 */
  readonly server: HttpHost | undefined;
  readonly register: (route: WebRoute) => () => void;
  readonly registerUpgrade: (route: WebUpgradeRoute) => () => void;
  readonly registerFallback: (
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ) => () => void;
  /** 已注册的路由快照（方法而不是属性：abstract 属性在运行时没有原型痕迹，面代理取不到）。 */
  readonly routesOf: () => readonly RegisteredRoute[];
}

/** 底层 http server 的最小面（node `http.Server` 与 `@hono/node-server` 的返回值都满足）。 */
export interface HttpHost {
  on(event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
  close(callback?: () => void): unknown;
  address(): { port: number } | string | null;
  listen(port: number, host: string, callback?: () => void): unknown;
}

/** 已注册路由的一条记录。`kind` 对 fallback 是 `"fallback"`。 */
export interface RegisteredRoute {
  readonly kind: "prefix" | "exact" | "fallback" | "upgrade";
  readonly path: string;
}

@Injectable()
export abstract class WebServer implements WebServerFace {
  abstract readonly host: WebServerFace["host"];

  abstract readonly port: WebServerFace["port"];

  abstract readonly protocol: WebServerFace["protocol"];

  abstract readonly server: WebServerFace["server"];

  abstract register(route: WebRoute): () => void;

  abstract registerUpgrade(route: WebUpgradeRoute): () => void;

  abstract registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): () => void;

  abstract routesOf(): readonly RegisteredRoute[];



}
