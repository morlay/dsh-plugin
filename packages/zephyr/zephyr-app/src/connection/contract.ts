// 浏览器侧的连接面（令牌按服务语义命名：上游注册名 `connection`）。
//
// 只放**传输**——成员集合按上游消费面定（`api-gateway/client` 用 generation / interactions /
// isLoopback / openWebSocket / registerGenerationSource / rpc / start）。认证不在这层。
import { Injectable } from "@morlay/zephyr";

/** 连接世代（上游 `connection.generation`）：`id` 递增，`host` 是当前连接的主机信息。 */
export interface ConnectionGeneration {
  readonly id: number;
  readonly host: unknown;
}

interface ConnectionFace {
  readonly interactions: "answer" | "none";
  readonly generation: ConnectionGeneration | undefined;
  readonly isLoopback: boolean;
  readonly openWebSocket: (path: string) => WebSocket;
  readonly registerGenerationSource: (source: unknown) => () => void;
  readonly rpc: { readonly open?: (...args: never[]) => unknown };
  readonly start: (sinks: unknown) => { stop(): void };
}

@Injectable()
export abstract class Connection implements ConnectionFace {
  abstract readonly interactions: ConnectionFace["interactions"];

  abstract readonly generation: ConnectionFace["generation"];

  abstract readonly isLoopback: ConnectionFace["isLoopback"];

  abstract readonly openWebSocket: ConnectionFace["openWebSocket"];

  abstract readonly registerGenerationSource: ConnectionFace["registerGenerationSource"];

  abstract readonly rpc: ConnectionFace["rpc"];

  abstract readonly start: ConnectionFace["start"];
}
