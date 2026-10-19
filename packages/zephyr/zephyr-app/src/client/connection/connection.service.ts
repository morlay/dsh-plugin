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

/** 装配选项：`origin` 是「这个进程对外的地址」，浏览器里默认取 `location`。 */
export interface ClientConnectionOptions {
  /** 形如 `http://127.0.0.1:3080`；非浏览器宿主必须显式给。 */
  readonly origin?: string;
}

@Injectable()
export class ClientConnectionDefault extends Connection implements OnInit {
  readonly interactions = "answer" as const;

  private readonly options: ClientConnectionOptions;

  constructor(options: ClientConnectionOptions = {}) {
    super();
    this.options = options;
  }

  /** 这个进程的 origin：显式配置优先，其次才是浏览器事实。 */
  private get origin(): string {
    if (this.options.origin !== undefined) return this.options.origin;
    return typeof location === "undefined" ? "" : location.origin;
  }

  /**
   * 连接世代：**总是 observable**（未连接时给 `{ id: 0, host: undefined }`）。
   *
   * 上游 `ClientRemoteService.$host` 无条件 `connection.generation.getSnapshot()`，
   * 给它 `undefined` 会在渲染期直接炸。
   */
  readonly generation = {
    getSnapshot: (): { id: number; host: { home: string } } => ({ id: 0, host: { home: this.origin } }),
    subscribe: (): (() => void) => () => {},
  };

  readonly isLoopback = true;

  readonly registerGenerationSource = (): (() => void) => () => {};

  readonly openWebSocket = (path: string): WebSocket => {
    const origin = this.origin;
    return new WebSocket(`${origin.replace(/^http/, "ws")}${path}`);
  };

  readonly rpc: RpcFace = {
    open: async (channel, endpoint, payload, signal) => {
      const response = await fetch(`${this.origin}${channel}/${endpoint}`, {
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

  /**
   * 连接恢复状态：本实现的传输是「每次 RPC 直连 fetch」，没有长连接与退避循环，
   * 所以在页面上恒为已连接。上游设置页拿它渲染"重连"入口，形状对齐即可。
   */
  readonly state = {
    // 值域是上游的 `ConnectionState`（`'connected' | 'disconnected' | 'connecting'`）。
    // 这里恒 `'connected'`：本实现的传输是每次 RPC 直连 fetch，没有可断的长连接。
    getSnapshot: (): "connected" => "connected",
    subscribe: (): (() => void) => () => {},
  };

  /** 没有长连接可重连：空实现（设置页的「重连」按钮点了不做事）。 */
  reconnect(): void {}

  readonly start = (): { stop(): void } => ({ stop: () => {} });

  onInit(): void {
    // 纯传输面：没有需要装配的东西。
  }
}
