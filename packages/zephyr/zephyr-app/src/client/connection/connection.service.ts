// connection 的 client 半：**自己实现**（不走上游 `apply`，也不依赖它的 `installConnection`）。
//
// 契约只有四个成员：`interactions` / `openWebSocket` / `rpc` / `start`。
// 上游实现把它们和认证、全局 transport 钩子缠在一起，且实测 `ctx.provide` 没进我们的作用域——
// 与其猜，不如按契约自己实现：同源 HTTP + WebSocket，`rpc.open` 走 fetch。
import { Injectable, type OnInit } from "@morlay/zephyr";
import { Connection } from "../../connection/contract.ts";

/** RPC 载体：`open(channel, endpoint, payload)` 走同源 HTTP POST。 */
interface RpcFace {
  readonly open?: (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly handle: (channel: string, handler: unknown) => () => void;
  readonly intercept: (
    channel: string,
    matches: unknown,
    handler: unknown,
  ) => () => void;
}

@Injectable()
export class ClientConnectionDefault extends Connection implements OnInit {
  readonly interactions = "answer" as const;

  readonly generation = undefined;

  readonly isLoopback = true;

  readonly registerGenerationSource = (): (() => void) => () => {};

  readonly openWebSocket = (path: string): WebSocket =>
    new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`);

  readonly rpc: RpcFace = {
    open: async (channel, endpoint, payload, signal) => {
      const response = await fetch(`${channel}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        ...(signal === undefined ? {} : { signal }),
      });
      return response.json();
    },
    handle: () => () => {},
    intercept: () => () => {},
  };

  readonly start = (): { stop(): void } => ({ stop: () => {} });

  onInit(): void {
    // 纯传输面：没有需要装配的东西。
  }
}
