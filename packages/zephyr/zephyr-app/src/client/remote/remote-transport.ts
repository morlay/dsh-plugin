// remote 的**传输接缝**：`RemoteDefault` 只依赖它，不依赖 WebSocket/HTTP 的具体形态。
//
// 上游把「一次 remote 调用」编码成 mux 的一条逻辑流（`/api/remote.mux`）：
//   客户端 `{ type:'open', streamId, endpoint:'<ns>/<method>', payload }`
//   宿主   `{ type:'item', streamId, value }`（结果）→ `{ type:'end' }`
// 这里只抽象成 `invoke()`：实现可以是 mux（生产）、内存（测试）。
import type { Connection } from "../../connection/contract.ts";

/** 一次 remote 调用。 */
export interface RemoteTransport {
  /**
   * 调用一个 remote 方法。
   * @param endpoint - `<namespace>/<method>`。
   * @param payload - wire 载荷（上游要求 `{ args: <plain object> }`）。
   * @returns 宿主的返回值。
   */
  invoke(endpoint: string, payload: object): Promise<unknown>;

  /**
   * 打开一个**流式** remote 方法（`workspace/follow` 这类，宿主逐帧回 `item`）。
   * @param endpoint - `<namespace>/<method>`。
   * @param payload - wire 载荷（`{ args: <plain object> }`）。
   * @param signal - 取消信号：abort 时向宿主发 `cancel` 并结束迭代。
   * @returns 宿主逐帧产出的值。
   */
  openStream(endpoint: string, payload: object, signal: AbortSignal): AsyncIterable<unknown>;

  /**
   * 订阅宿主的推送（events 流，读到 `api-session/*` 那类帧时回调）。
   * @param deliver - 收到一帧时调用它（`channel` + 载荷）。
   * @returns 退订函数。
   */
  subscribe?(deliver: (channel: string, ...args: unknown[]) => void): () => void;
}

/** 一条逻辑流在客户端的下行缓冲。 */
interface StreamSink {
  /** 宿主发来一帧。 */
  push(value: unknown): void;
  /** 宿主结束这条流。 */
  end(): void;
  /** 宿主报错（或载体断开）。 */
  fail(error: Error): void;
}

/** mux 的路径（上游 `REMOTE_STREAM_MUX_PATH`）。 */
const MUX_PATH = "/api/remote.mux";

/**
 * 生产实现：走 `/api/remote.mux` 的 WebSocket 多路复用。
 *
 * 一条 unary 调用 = `open` → 收 `item` → 收 `end`；出错时宿主发 `error` 帧。
 * @param connectionOf - 传输层（保留参数：将来若要自定义 socket 工厂，从这里取）。
 *   当前实现直接用浏览器原生 `WebSocket` + `location`，不依赖上游的 `openWebSocket`。
 * @returns 传输实现。
 */
export function muxTransport(connectionOf?: () => Connection): RemoteTransport {
  let socket: WebSocket | undefined;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  /** 逻辑流的下行队列（`openStream` 开的那几条）。 */
  const streams = new Map<string, StreamSink>();
  let seq = 0;

  let eventDeliver: ((channel: string, ...args: unknown[]) => void) | undefined;

  /** 待发帧（socket 还在 CONNECTING 时排队，open 后一次性发）。 */
  const queued: string[] = [];

  /** 发一帧：已 open 直接发，否则排队。 */
  const send = (text: string): void => {
    const ws = ensure();
    if (ws.readyState === 1) ws.send(text);
    else queued.push(text);
  };

  /**
   * 载体断开时把**在途**调用全部按失败收场。
   *
   * 挂着的 Promise 比报错糟得多：上游 `ConfigFormController` 的写队列是**串行**的（`tail` 等前一次
   * 调用结算），一次永不应答的调用会把它堵死——之后所有写请求连帧都发不出去，`ui-theme` 的
   * `pendingWrites` 也永远不归零（`adopt()` 从此不跑）。界面上就是「点了没反应，也没有报错」。
   * @param error - 给每个在途调用/流的失败原因。
   */
  const failInFlight = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const sink of streams.values()) sink.fail(error);
    streams.clear();
    // 排队帧属于刚刚被拒掉的那些调用：不能在下一个 socket 上补发（那会变成「调用方以为失败、
    // 宿主其实执行了」的幽灵写）。`$events` 的 open 帧由新 socket 的 open 回调重发。
    queued.length = 0;
  };

  const ensure = (): WebSocket => {
    if (socket !== undefined && (socket.readyState === 0 || socket.readyState === 1)) return socket;
    // 有工厂就用工厂（测试 / 非浏览器宿主），否则按浏览器 `location` 自己拼 URL。
    const connection = connectionOf?.();
    if (connection?.openWebSocket !== undefined) {
      socket = connection.openWebSocket(MUX_PATH);
      console.debug("[remote] mux 建连（工厂）readyState=", socket.readyState);
    } else {
      const base = typeof location === "undefined" ? "" : location.origin.replace(/^http/, "ws");
      const url = `${base}${MUX_PATH}`;
      console.debug("[remote] mux 建连 %s", url);
      socket = new WebSocket(url);
      console.debug("[remote] mux 建连完成 readyState=", socket.readyState);
    }
    // 这一代的 socket 句柄：`close` 只收自己那一代的在途调用（重连后的新调用不受影响）。
    const live = socket;
    live.addEventListener("close", () => {
      if (socket !== live) return;
      socket = undefined;
      console.debug("[remote] mux 断开，在途调用 %d / 流 %d", pending.size, streams.size);
      failInFlight(new Error("remote 连接已断开：在途调用未完成（宿主重启或网络中断）"));
    });
    socket.addEventListener("open", () => {
      console.debug("[remote] mux open，待发帧", queued.length);
      try {
        for (const text of queued.splice(0)) {
          if (typeof text !== "string" || text.length === 0) {
            console.error("[remote] 排队帧不是字符串，跳过：", text);
            continue;
          }
          socket?.send(text);
        }
      } catch (error) {
        // 回调里抛错会被浏览器吞成一条没有上下文的 pageerror——这里必须留痕。
        console.error("[remote] mux open 后补发排队帧失败：", error);
      }
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      try {
      let frame: { type?: string; streamId?: string; value?: unknown; error?: { message?: string } };
      try {
        frame = JSON.parse(String(event.data)) as typeof frame;
      } catch {
        return;
      }
      const id = frame.streamId;
      if (id === EVENT_STREAM) {
        if (frame.type !== "item") return;
        const value = frame.value as { channel?: string; args?: readonly unknown[] } | undefined;
        if (typeof value?.channel !== "string") return;
        eventDeliver?.(value.channel, ...((value.args ?? []) as unknown[]));
        return;
      }
      if (id === undefined) return;
      const sink = streams.get(id);
      if (sink !== undefined) {
        if (frame.type === "item") {
          sink.push(frame.value);
          return;
        }
        if (frame.type === "error") {
          streams.delete(id);
          sink.fail(new Error(frame.error?.message ?? "remote 流失败"));
          return;
        }
        if (frame.type === "end") {
          streams.delete(id);
          sink.end();
        }
        return;
      }
      const waiter = pending.get(id);
      if (waiter === undefined) return;
      if (frame.type === "item") {
        waiter.resolve(frame.value);
        return;
      }
      if (frame.type === "error") {
        pending.delete(id);
        waiter.reject(new Error(frame.error?.message ?? "remote 调用失败"));
        return;
      }
      if (frame.type === "end") pending.delete(id);
      } catch (error) {
        console.error("[remote] mux 处理帧失败：", error);
      }
    });
    socket.addEventListener("error", (event) => {
      console.error("[remote] mux socket error：", event);
    });
    // 连上之后补开 events 流（只开一次）。
    if (eventDeliver !== undefined) {
      send(
        JSON.stringify({
          type: "open",
          streamId: EVENT_STREAM,
          endpoint: EVENT_STREAM,
          payload: { args: {} },
        }),
      );
    }
    return socket;
  };

  /** `$events` 流的 id（上游常量 `REMOTE_EVENT_STREAM_ENDPOINT`）。 */
  const EVENT_STREAM = "$events";

  return {
    subscribe(deliver) {
      // **不在这里建连**：`$on` 可能在 `onInit` 期被调用，那时 `Connection` 还是占位符。
      // 只登记回调；真正连上（`ensure`）之后由它补发 `$events` 的 open 帧。
      eventDeliver = deliver;
      return () => {
        eventDeliver = undefined;
      };
    },
    invoke(endpoint, payload) {
      const streamId = `s${(seq += 1)}`;
      return new Promise<unknown>((resolve, reject) => {
        pending.set(streamId, { resolve, reject });
        send(JSON.stringify({ type: "open", streamId, endpoint, payload }));
      });
    },
    openStream(endpoint, payload, signal) {
      const streamId = `s${(seq += 1)}`;
      const queue: unknown[] = [];
      let finished = false;
      let failure: Error | undefined;
      let wake: (() => void) | undefined;
      const settle = (): void => {
        const resolve = wake;
        wake = undefined;
        resolve?.();
      };
      streams.set(streamId, {
        push: (value) => {
          queue.push(value);
          settle();
        },
        end: () => {
          finished = true;
          settle();
        },
        fail: (error) => {
          failure = error;
          finished = true;
          settle();
        },
      });
      // 取消：告诉宿主别再发（`cancel` 帧），并让迭代立刻结束。
      const onAbort = (): void => {
        if (finished) return;
        streams.delete(streamId);
        send(JSON.stringify({ type: "cancel", streamId }));
        finished = true;
        settle();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      send(JSON.stringify({ type: "open", streamId, endpoint, payload }));

      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
          try {
            for (;;) {
              if (queue.length > 0) {
                yield queue.shift();
                continue;
              }
              if (failure !== undefined) throw failure;
              if (finished) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          } finally {
            streams.delete(streamId);
            signal.removeEventListener("abort", onAbort);
          }
        },
      };
    },
  };
}

/**
 * 测试实现：内存里按 `endpoint` 返回固定值（mock server）。
 * @param handlers - unary `endpoint` → 返回值。
 * @param streams - 流式 `endpoint` → 帧序列（省略时流式调用直接报错）。
 * @returns 传输实现。
 */
export function mockTransport(
  handlers: Readonly<Record<string, (payload: { readonly args?: unknown }) => unknown>>,
  streams: Readonly<Record<string, (payload: { readonly args?: unknown }) => AsyncIterable<unknown>>> = {},
): RemoteTransport & { emit(channel: string, ...args: unknown[]): void } {
  const listeners = new Set<(channel: string, ...args: unknown[]) => void>();
  return {
    subscribe(deliver) {
      listeners.add(deliver);
      return () => {
        listeners.delete(deliver);
      };
    },
    emit(channel, ...args) {
      for (const listener of listeners) listener(channel, ...args);
    },
    async invoke(endpoint, payload) {
      const handler = handlers[endpoint];
      if (handler === undefined) throw new Error(`mock server: 没有 ${endpoint} 的实现`);
      return handler(payload);
    },
    openStream(endpoint, payload) {
      const handler = streams[endpoint];
      if (handler === undefined) throw new Error(`mock server: 没有 ${endpoint} 的流实现`);
      return handler(payload);
    },
  };
}
