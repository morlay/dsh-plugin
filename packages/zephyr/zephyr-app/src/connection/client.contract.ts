// 浏览器侧的连接面（本仓自研实现，不跑上游 `client-connection` 的 `apply`）。
//
// 上游浏览器半的 `apply` 把传输、认证与全局钩子缠在一起，且它注册的服务名与宿主同名（`connection`）——
// 同一份契约面装不下两个进程的角色，所以这里单独一个契约：`client-connection`。
import { Injectable } from "@morlay/zephyr";

/** 连接世代（上游 `connection.generation`）：`id` 递增，`host` 是当前连接的主机信息。 */
export interface ConnectionGeneration {
  readonly id: number;
  /** 当前连接的主机信息（上游 `$host` 读 `host.home`）。 */
  readonly host: { readonly home: string };
}

interface ClientConnectionFace {
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

// 服务名是派生的 `client-connection`：**不占** `connection`（那是宿主面契约的名字，混合装配会撞）。
// 上游浏览器行按 `ctx.connection` 读，由装配用 `publishingTo(ClientConnection, "connection")` 显式给。
@Injectable()
export abstract class ClientConnection implements ClientConnectionFace {
  abstract readonly interactions: ClientConnectionFace["interactions"];

  abstract readonly generation: ClientConnectionFace["generation"];

  abstract readonly isLoopback: ClientConnectionFace["isLoopback"];

  abstract readonly openWebSocket: ClientConnectionFace["openWebSocket"];

  /** 连接恢复状态（`ui-settings-general` 的设置页要读它显示"重连"）。 */
  abstract readonly state: ClientConnectionFace["state"];

  /** 立刻重连（重置退避并替换当前尝试）。 */
  abstract reconnect(): void;

  abstract readonly registerGenerationSource: ClientConnectionFace["registerGenerationSource"];

  abstract readonly rpc: ClientConnectionFace["rpc"];

  abstract readonly start: ClientConnectionFace["start"];
}
