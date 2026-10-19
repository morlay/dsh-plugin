// 浏览器侧的连接面（令牌按服务语义命名：上游注册名 `connection`）。
//
// 只放**传输**——成员集合按上游消费面定（`api-gateway/client` 用 generation / interactions /
// isLoopback / openWebSocket / registerGenerationSource / rpc / start）。认证不在这层。
import { Injectable } from "@morlay/zephyr";

/** 连接世代（上游 `connection.generation`）：`id` 递增，`host` 是当前连接的主机信息。 */
export interface ConnectionGeneration {
  readonly id: number;
  /** 当前连接的主机信息（上游 `$host` 读 `host.home`）。 */
  readonly host: { readonly home: string };
}

interface ConnectionFace {
  readonly interactions: "answer" | "none";
  /**
   * 连接世代：**总是 observable**（未连接时给 `{ id: 0, host: undefined }`）。
   *
   * 消费方（上游 `ClientRemoteService.$host`、`ui-workspace`）无条件 `getSnapshot()`，
   * 给 `undefined` 会在渲染期直接炸。
   */
  readonly generation: {
    getSnapshot(): ConnectionGeneration;
    subscribe(fn: () => void): () => void;
  };
  readonly isLoopback: boolean;
  readonly openWebSocket: (path: string) => WebSocket;
  readonly registerGenerationSource: (source: unknown) => () => void;
  readonly rpc: { readonly open?: (...args: never[]) => unknown };
  /** 连接恢复状态：设置页读它渲染「重连」入口。 */
  readonly state: {
    getSnapshot(): "connected" | "disconnected" | "connecting" | undefined;
    subscribe(fn: () => void): () => void;
  };
  /** 立刻重连（没有长连接时可空实现）。 */
  reconnect(): void;
  readonly start: (sinks: unknown) => { stop(): void };
}

@Injectable()
export abstract class Connection implements ConnectionFace {
  abstract readonly interactions: ConnectionFace["interactions"];

  abstract readonly generation: ConnectionFace["generation"];

  abstract readonly isLoopback: ConnectionFace["isLoopback"];

  abstract readonly openWebSocket: ConnectionFace["openWebSocket"];

  /** 连接恢复状态（`ui-settings-general` 的设置页要读它显示"重连"）。 */
  abstract readonly state: ConnectionFace["state"];

  /** 立刻重连（重置退避并替换当前尝试）。 */
  abstract reconnect(): void;

  abstract readonly registerGenerationSource: ConnectionFace["registerGenerationSource"];

  abstract readonly rpc: ConnectionFace["rpc"];

  abstract readonly start: ConnectionFace["start"];
}
