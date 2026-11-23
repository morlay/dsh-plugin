// connection 的 client 半：**自己实现**（不走上游 `apply`，也不依赖它的 `installConnection`）。
//
// 契约只有四个成员：`interactions` / `openWebSocket` / `rpc` / `start`。
// 上游实现把它们和认证、全局 transport 钩子缠在一起，且实测 `ctx.provide` 没进我们的作用域——
// 与其猜，不如按契约自己实现：同源 HTTP + WebSocket，`rpc.open` 走 fetch。
import { Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { ClientConnection } from "@morlay/zephyr-app/contract";

/** RPC 载体：`open(channel, endpoint, payload)` 走同源 HTTP POST。 */
interface RpcFace {
  readonly open?: (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly handle: (channel: string, handler: unknown) => () => void;
  readonly intercept: (channel: string, matches: unknown, handler: unknown) => () => void;
}

/** 装配选项：`origin` 是「这个进程对外的地址」，浏览器里默认取 `location`。 */
export interface ClientConnectionOptions {
  /** 形如 `http://127.0.0.1:3080`；非浏览器宿主必须显式给。 */
  readonly origin?: string;
}

@Injectable()
export class ClientConnectionDefault extends ClientConnection implements OnInit {
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
    getSnapshot: (): { id: number; host: { home: string } } => ({
      id: 0,
      host: { home: this.origin },
    }),
    subscribe: (): (() => void) => () => {},
  };

  readonly isLoopback = true;

  readonly registerGenerationSource = (): (() => void) => () => {};

  readonly openWebSocket = (path: string): WebSocket => {
    const origin = this.origin;
    this.lastSocketPath = path;
    this.setState("connecting");
    const socket = new WebSocket(`${origin.replace(/^http/, "ws")}${path}`);
    this.lastSocket = socket;
    socket.addEventListener("open", () => {
      if (this.lastSocket === socket) this.setState("connected");
    });
    // 断开与失败都算"没连上"：宿主关了之后侧栏不该还显示「已连接」。
    socket.addEventListener("close", () => {
      if (this.lastSocket === socket) this.setState("disconnected");
    });
    socket.addEventListener("error", () => {
      if (this.lastSocket === socket) this.setState("disconnected");
    });
    return socket;
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

  /** 当前连接状态：由**真实 socket 生命周期**驱动（open / close / error）。 */
  private snapshot: "connected" | "connecting" | "disconnected" = "connecting";

  private readonly listeners = new Set<() => void>();

  /** 最后一次建连的路径：`reconnect()` 用它重开一条。 */
  private lastSocketPath: string | undefined;

  /**
   * 连接恢复状态（上游设置页与侧栏的「重连」入口读它）。
   *
   * 值域与上游同形，来源是真实的 mux socket：`open` → `connected`，`close` / `error` → `disconnected`。
   * 之前这里恒 `connected`，所以宿主断了前端没有任何反应。
   */
  readonly state = {
    getSnapshot: (): "connected" | "connecting" | "disconnected" => this.snapshot,
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    },
  };

  /** 换状态并通知订阅者（同值不通知：快照身份要稳定）。 */
  private setState(next: "connected" | "connecting" | "disconnected"): void {
    if (this.snapshot === next) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * 立刻重连：把当前 socket 断开，传输层（`muxTransport`）会在下一次调用 `openWebSocket` 时重开。
   * @returns 无。
   */
  reconnect(): void {
    this.setState("connecting");
    this.lastSocket?.close();
  }

  /** 当前由本行建出的 socket（`reconnect` 要能把它掐掉）。 */
  private lastSocket: WebSocket | undefined;

  readonly start = (): { stop(): void } => ({ stop: () => {} });

  onInit(ctx: Context): void {
    // 浏览器进程里 `connection` 就该是这一面（上游浏览器行按这个名严格读）。混合装配里宿主面先在时
    // 让位给它——那种装配不真实，本仓只有测试会这么拼。
    if (ctx.get("connection", false) === undefined) ctx.provide("connection", this);
  }
}
