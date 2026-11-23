// remote 的**传输接缝**：`RemoteDefault` 只依赖它，不依赖 WebSocket/HTTP 的具体形态。
//
// 上游把「一次 remote 调用」编码成 mux 的一条逻辑流（`/api/remote.mux`）：
//   客户端 `{ type:'open', streamId, endpoint:'<ns>/<method>', payload }`
//   宿主   `{ type:'item', streamId, value }`（结果）→ `{ type:'end' }`
// 这里只抽象成 `invoke()`：实现可以是 mux（生产）、内存（测试）。
import type { ClientConnection } from "@morlay/zephyr-app/contract";

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
  openStream(endpoint: string, payload: object, signal: AbortSignal): RemoteStreamFace;

  /**
   * 订阅宿主的推送（events 流，读到 `api-session/*` 那类帧时回调）。
   * @param deliver - 收到一帧时调用它（`channel` + 载荷）。
   * @returns 退订函数。
   */
  subscribe?(deliver: (channel: string, ...args: unknown[]) => void): () => void;

  /**
   * 注册**要答复**的转发事件（上游 `waterfall` 帧：审批、用户提问）。
   *
   * 与 {@link RemoteTransport.subscribe} 的区别是返回值：这里每个请求都要给一个结果，
   * 传输层负责把它送回宿主（上游 wire 是 unary 端点 `$events/result`）。
   * @param handle - 收到一条请求时调用它，返回本次的结论。
   * @returns 退订函数。
   */
  answer?(handle: (invocation: RemoteInvocation) => Promise<RemoteOutcome>): () => void;
}

/** 一段宿主发来的转发事件参数（上游 `waterfall` 帧的客户端面）。 */
export interface RemoteInvocation {
  /** 原始事件名（`approval/request`）。 */
  readonly event: string;
  /** 宿主给这次请求的关联 id（答复时带回去）。 */
  readonly eventId: string;
  /** 请求所属的 agent（客户端据此找到对应的会话作用域）。 */
  readonly agentId: string;
  /** 已投影成 JSON 安全的请求（**没有** `agent` / `signal`）。 */
  readonly request: Readonly<Record<string, unknown>>;
  /** 这条请求的取消信号（宿主撤回、或载体换代时 abort）。 */
  readonly signal: AbortSignal;
}

/** 一条请求的结论（上游 `TypertRemoteEventOutcome` 的线上形状）。 */
export type RemoteOutcome =
  | { readonly kind: "result"; readonly value?: unknown }
  | { readonly kind: "next" }
  | {
      readonly kind: "rejected";
      readonly error: { readonly name: string; readonly message: string };
    };

/**
 * 一条逻辑流的客户端面：下行逐帧 + **上行**（`send` / `end`）。
 *
 * 上行不是所有流都要（`workspace/follow` 只下行），但双向流（终端的 `terminal/attach`）靠它把键入
 * 送给宿主——上游的 `RemoteStreamHandle` 就是 `AsyncIterable & { send, end, dispose }` 这个形状。
 */
export interface RemoteStreamFace extends AsyncIterable<unknown> {
  /** 送一条上行帧（宿主按方法声明的 uplink codec 校验）。 */
  send(item: unknown): void;

  /** 半关上行（宿主那边的 uplink 迭代结束）。 */
  end(): void;
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

/** 一次 HTTP 请求（同 `fetch` 的签名）：测试注入用，生产是页面自己的 `fetch`。 */
export type RemoteFetch = (input: string | URL, init: RequestInit) => Promise<Response>;

/**
 * 生产实现：`/api/remote.mux` 的 WebSocket 承载**流式**方法，unary 走 `/api` 的 HTTP RPC。
 *
 * 两条 wire 是上游分的：mux 只接受 `mode === 'stream'` 的方法（unary 打开会被拒），
 * unary 的请求信封是 `{type:'client-request', rpcId, method, payload}`。
 * @param connectionOf - 传输层（只在这里取 socket 工厂）。
 * @param fetchOf - HTTP 载体；缺省用页面的 `fetch`（测试注入替身）。
 * @returns 传输实现。
 */
export function muxTransport(
  connectionOf?: () => ClientConnection,
  fetchOf?: RemoteFetch,
): RemoteTransport {
  let socket: WebSocket | undefined;
  /** 逻辑流的下行队列（`openStream` 开的那几条）。 */
  const streams = new Map<string, StreamSink>();
  let seq = 0;

  let eventDeliver: ((channel: string, ...args: unknown[]) => void) | undefined;

  /** 可答复事件的处理者（`waterfall` 帧：审批 / 提问）。 */
  let answerHandler: ((invocation: RemoteInvocation) => Promise<RemoteOutcome>) | undefined;

  /** 宿主在 `ready` 帧给的本条事件流的客户端身份（答复时要带回去）。 */
  let clientId: string | undefined;

  /** 在途的可答复请求（宿主撤回时按 `eventId` abort）。 */
  const deliveries = new Map<string, AbortController>();

  /** 待发帧（socket 还在 CONNECTING 时排队，open 后一次性发）。 */
  const queued: string[] = [];

  /**
   * 已经开过 `$events` 的那一代 socket。
   *
   * 按**这一代的句柄**认，而不是按一个布尔量：订阅与要答复的人各自都会调一次「保证事件流在场」，
   * 建连本身也会补开一次，布尔量拦不住重入（`ensure` 里补开 → 外层再发一帧），宿主会收到两条
   * `$events` 流、同一条 waterfall 被投两边；而换了一代 socket 之后又必须重发，否则推送与
   * 审批/提问从此收不到。句柄比较两种情形都自然成立。
   */
  let eventsOpenedOn: WebSocket | undefined;

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
      console.debug("[remote] mux 断开，在途流 %d", streams.size);
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
        let frame: {
          type?: string;
          streamId?: string;
          value?: unknown;
          error?: { message?: string };
        };
        try {
          frame = JSON.parse(String(event.data)) as typeof frame;
        } catch {
          return;
        }
        const id = frame.streamId;
        if (id === EVENT_STREAM) {
          if (frame.type !== "item") return;
          // 上游 `$events` 流的帧形状（`api/gateway/src/stream-protocol.ts`）：
          //   `{type:'ready', clientId, host}` → `{type:'emit', event, args}`
          //   `{type:'waterfall', event, eventId, agentId, request}` → `{type:'cancel', eventId}`
          const value = frame.value as
            | {
                readonly type?: string;
                readonly clientId?: string;
                readonly event?: string;
                readonly args?: readonly unknown[];
                readonly eventId?: string;
                readonly agentId?: string;
                readonly request?: Record<string, unknown>;
              }
            | undefined;
          if (typeof value?.type !== "string") return;
          if (value.type === "ready") {
            clientId = value.clientId;
            return;
          }
          if (value.type === "cancel") {
            const eventId = value.eventId;
            if (typeof eventId === "string") deliveries.get(eventId)?.abort();
            return;
          }
          if (value.type === "emit") {
            if (typeof value.event !== "string") return;
            eventDeliver?.(value.event, ...((value.args ?? []) as unknown[]));
            return;
          }
          if (value.type !== "waterfall") return;
          if (
            typeof value.event !== "string" ||
            typeof value.eventId !== "string" ||
            typeof value.agentId !== "string"
          )
            return;
          const handler = answerHandler;
          if (handler === undefined) return;
          const eventId = value.eventId;
          const controller = new AbortController();
          deliveries.set(eventId, controller);
          void (async () => {
            let outcome: RemoteOutcome = { kind: "next" };
            try {
              outcome = await handler({
                event: value.event as string,
                eventId,
                agentId: value.agentId as string,
                request: value.request ?? {},
                signal: controller.signal,
              });
            } catch (error) {
              outcome = {
                kind: "rejected",
                error: {
                  name: error instanceof Error ? error.name : "Error",
                  message: error instanceof Error ? error.message : String(error),
                },
              };
            } finally {
              deliveries.delete(eventId);
            }
            // 答复走 unary 端点（上游 `REMOTE_EVENT_RESULT_ENDPOINT`）：载荷是
            // `{ clientId, eventId, outcome }`，宿主侧按这三项把答案喂回那条 waterfall。
            try {
              await callUnary("$events/result", {
                args: {
                  clientId,
                  eventId,
                  outcome:
                    outcome.kind === "result" && outcome.value === undefined
                      ? { kind: "result" }
                      : outcome,
                },
              });
            } catch (error) {
              console.error("[remote] 转发事件答复失败：", error);
            }
          })();
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
        }
      } catch (error) {
        console.error("[remote] mux 处理帧失败：", error);
      }
    });
    socket.addEventListener("error", (event) => {
      console.error("[remote] mux socket error：", event);
    });
    // 连上之后补开 events 流（只开一次）。
    if (eventDeliver !== undefined || answerHandler !== undefined) openEvents();
    return socket;
  };

  /**
   * 有人订阅/要答复时保证事件流在场。
   *
   * unary 走 HTTP 之后**没有任何调用会顺手建 socket**：页面里靠 `workspace/follow` 这类流式方法
   * 把连接带起来，但只调 unary 的场景（以及测试）就永远连不上，`$events` 不开、推送与审批/提问
   * 全收不到。这里建连，失败只记一笔（纯 unary 的替身没有 socket 工厂，不该因此炸装配）。
   */
  const connectEventsSafe = (): void => {
    try {
      openEvents();
    } catch (error) {
      console.debug("[remote] 事件流建连失败（本次装配没有 socket 载体）：", String(error));
    }
  };

  /** `$events` 流的 id（上游常量 `REMOTE_EVENT_STREAM_ENDPOINT`）。 */
  const EVENT_STREAM = "$events";

  /**
   * 开一条事件流：**这一代 socket 上只发一次**。
   *
   * 宿主按 streamId 认流，重复 `open` 会多出一条同 id 的流（推送重复投递、waterfall 请求被投多次），
   * 所以先按 {@link eventsOpenedOn} 记账再发；换代（重连）后句柄不同，自然重发。
   */
  const openEvents = (): void => {
    const ws = ensure();
    if (eventsOpenedOn === ws) return;
    eventsOpenedOn = ws;
    send(
      JSON.stringify({
        type: "open",
        streamId: EVENT_STREAM,
        endpoint: EVENT_STREAM,
        payload: { args: {} },
      }),
    );
  };

  /**
   * 一条 unary 调用（`invoke` 与「转发事件答复」共用）：走 HTTP `POST /api/<endpoint>`。
   *
   * 上游 mux 只承载**流式**方法（unary 打开会被拒：`unary Remote methods cannot be opened through
   * the stream carrier`）；unary 的 wire 是 `connection.rpc` 那条 HTTP RPC
   * （`{type:'client-request', rpcId, method, payload}` → `{type:'server-response', rpcId, result}`），
   * 与本仓宿主 `connection` 行交给上游的分派器同一条路。
   * @param endpoint - `<namespace>/<method>`。
   * @param payload - wire 载荷（`{ args: <命名参数> }`）。
   * @param signal - 取消信号（转发事件答复不传）。
   * @returns 宿主结果（失败抛带 `code` / `details` 的错误）。
   */
  const callUnary = async (
    endpoint: string,
    payload: object,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    // 浏览器里就是当前页面的 origin；非浏览器宿主（node 测试、headless）没有 `location`，
    // 而这个部署只服务本机宿主，回落本机地址而不是拿相对 URL 去 `fetch`（那会直接抛
    // `Failed to parse URL`，症状是「测试里所有 unary 调用都挂」）。
    const base = typeof location === "undefined" ? "http://127.0.0.1" : location.origin;
    const doFetch: RemoteFetch = fetchOf ?? ((input, init) => globalThis.fetch(input, init));
    const rpcId = crypto.randomUUID();
    const response = await doFetch(`${base}/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok)
      throw new Error(`transport failure for /api/${endpoint}: HTTP ${response.status}`);
    const envelope = (await response.json()) as {
      readonly rpcId?: string;
      readonly result?:
        | { readonly ok: true; readonly value?: unknown }
        | {
            readonly ok: false;
            readonly error?: {
              readonly code?: string;
              readonly message?: string;
              readonly details?: unknown;
            };
          };
    };
    if (envelope.rpcId !== rpcId)
      throw new Error(
        `rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${String(envelope.rpcId)}`,
      );
    const result = envelope.result;
    if (result === undefined)
      throw new Error(`transport failure for /api/${endpoint}: 响应没有 result`);
    if (!result.ok) {
      const error = result.error ?? {};
      throw Object.assign(new Error(error.message ?? `${endpoint} 调用失败`), {
        code: error.code,
        details: error.details,
      });
    }
    return result.value;
  };

  return {
    subscribe(deliver) {
      // **不在这里建连**：`$on` 可能在 `onInit` 期被调用，那时 `ClientConnection` 还是占位符。
      eventDeliver = deliver;
      // **不在这里建连**：`$on` 可能在 `onInit` 期被调用，那时 `ClientConnection` 还是占位符，
      // 建出的 socket 会连到错地址、随即断开（`failInFlight` 会把在途流全判死）。
      // 建连由**第一次流式调用**触发（`ensure()`），那条路在 open 后会补开 `$events`。
      connectEventsSafe();
      return () => {
        eventDeliver = undefined;
      };
    },
    invoke: callUnary,
    answer(handle) {
      answerHandler = handle;
      // 同 `subscribe`：要答复事件的人在场，就必须有事件流。
      connectEventsSafe();
      return () => {
        if (answerHandler === handle) answerHandler = undefined;
      };
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
            // 迭代被 `return()`（上游 `RemoteStream.dispose()` 就是这么收尾的）时也要告诉宿主，
            // 否则它那条流永远不结：终端下次 attach 就抢不到 controller，`writable` 一直是 false
            // ——界面上"能看不能输入"。
            if (!finished) {
              finished = true;
              send(JSON.stringify({ type: "cancel", streamId }));
            }
          }
        },
        // 上行：`item` 帧 + `end` 帧。宿主没声明 uplink 的方法会忽略它们（服务端按方法签名分流）。
        send: (item: unknown): void => {
          if (finished) return;
          send(JSON.stringify({ type: "item", streamId, value: item }));
        },
        end: (): void => {
          if (finished) return;
          send(JSON.stringify({ type: "end", streamId }));
        },
      };
    },
  };
}

/**
 * 测试实现：内存里按 `endpoint` 返回固定值（mock server）。
 * @param handlers - unary `endpoint` → 返回值。
 * @param streams - 流式 `endpoint` → 帧序列（省略时流式调用直接报错）。
 *   收到调用方的 `signal`：替身的长流要按它收尾，否则消费方 `dispose()` 会挂在这一代。
 * @returns 传输实现。
 */
export function mockTransport(
  handlers: Readonly<Record<string, (payload: { readonly args?: unknown }) => unknown>>,
  streams: Readonly<
    Record<
      string,
      (payload: { readonly args?: unknown }, signal: AbortSignal) => AsyncIterable<unknown>
    >
  > = {},
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
    openStream(endpoint, payload, signal) {
      const handler = streams[endpoint];
      if (handler === undefined) throw new Error(`mock server: 没有 ${endpoint} 的流实现`);
      // 替身不实现上行（要测双向流就往 `streams` 里给一个带 `send` 的对象）。
      return Object.assign(handler(payload, signal), { send: () => {}, end: () => {} });
    },
  };
}
