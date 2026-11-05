// `/api/remote.mux` 的服务端：**自实现**（握手 + 帧 + 分发），不经过上游的 admission / cookie。
//
// 上游那套要求浏览器先拿认证 cookie（`authorizeIndex`），而我们的页面由 vite 出、也没有 token 启动流程；
// 与其把那套接进来，不如按 wire 协议自己实现——行为只有三条：
//   `{type:'open', streamId, endpoint, payload}` → 调 Remote 方法 → 回 `item` + `end`
//   出错回 `{type:'error', streamId, error:{code, message, details}}`
//   客户端发 `end` / `cancel` 时收尾
// 帧格式是 RFC 6455：客户端发来的帧必须带掩码，服务端回帧不带。
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { API_REMOTE_FORWARDED_EVENTS } from "@deepseek-ai/dsh-api-remotes";
import { inject, Injectable, Logger, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "./remote-handlers.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";
import { TypertGateway } from "../typert/gateway.contract.ts";
import { Typert } from "../typert/typert.contract.ts";

/** mux 的路径（与客户端 `muxTransport` 一致）。 */
const MUX_PATH = "/api/remote.mux";

/**
 * 客户端可订阅的**转发事件频道**：直接用上游那份 allowlist，不在框架里抄业务清单。
 *
 * 上游 `API_REMOTE_FORWARDED_EVENTS` 是这件事的唯一 home（Host 的转发循环与消费侧
 * `ctx.remote.$on` 的键面都读它）。框架只关心"转发哪些频道"，不关心有哪些业务事件；
 * 少抄一份也少一处漂移。
 */
const FORWARDED_CHANNELS: readonly string[] = API_REMOTE_FORWARDED_EVENTS.map(
  (entry) => entry.event,
);

/** RFC 6455 的握手固定串。 */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** 客户端发来的一帧（只用到文本帧的这几种）。 */
interface ClientFrame {
  readonly opcode: number;
  readonly payload: Buffer;
}

/** 从累积缓冲里切出一帧；不够一帧时返回 `undefined`。 */
function readFrame(buffer: Buffer): ClientFrame | undefined {
  if (buffer.length < 2) return undefined;
  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return undefined;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return undefined;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 2 ** 32 + low;
    offset += 8;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = (payload[index] ?? 0) ^ (buffer[maskOffset + (index % 4)] ?? 0);
    }
  }
  const frame: ClientFrame = { opcode, payload };
  // 用不可枚举的余量表达「消费了多少字节」，避免再包一层返回类型。
  Object.defineProperty(frame, "consumed", { value: offset + length });
  return frame;
}

/** 一帧消费掉的字节数。 */
function consumedOf(frame: ClientFrame): number {
  return (frame as unknown as { consumed: number }).consumed;
}

/** 服务端发一帧文本（不掩码）。 */
function writeText(socket: Duplex, text: string): void {
  const payload = Buffer.from(text, "utf8");
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : payload.length < 65_536
        ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
        : (() => {
            const buffer = Buffer.alloc(10);
            buffer[0] = 0x81;
            buffer[1] = 127;
            buffer.writeBigUInt64BE(BigInt(payload.length), 2);
            return buffer;
          })();
  try {
    socket.write(Buffer.concat([header, payload]));
  } catch {
    // 对端已断开：写帧失败不是本层的失败（客户端不再需要这些帧）。
  }
}

@Injectable()
export class MuxServer implements OnDispose {
  /** Remote 方法的路由表：谁提供服务谁注册，不经过全局服务名。 */
  private readonly handlers = inject(RemoteHandlers);

  /** 上游 `typertGateway`：上游 `@Remote` 端点的分派面。 */
  private readonly gateway = inject(TypertGateway);

  /**
   * 上游 `typert` 注册表：查 endpoint 的 descriptor（流式端点要按载具分流）。
   *
   * `optional` + 惰性 Proxy：`inject` 只在**读属性**时求值，所以只装 mux 的接缝测试
   * （`new MuxServer()` + `Object.assign` 覆盖）不会因为它没有提供者而抛。
   */
  /**
   * 读 `typert` 注册表；没有提供者时给 `undefined`。
   *
   * `inject.optional` 只宽容"提供者的值可能为 undefined"，**令牌完全没提供者时读它仍会抛**
   * （`dependency "typert" is not ready yet`）——只装 mux 的接缝测试与纯客户端装配都属于这种。
   * @returns 注册表，或 `undefined`。
   */
  /**
   * 上游 `typert` 注册表：查 endpoint 的 descriptor（流式端点要按载具分流）。
   *
   * **字段注入**（与 `gateway` 同款）：这样 `bootstrapApplication` 的 `resolvePending` 会把它
   * 解析成本行的依赖；写成 getter 里读时 `inject` 拿不到（那时构造期已过）。
   */
  private readonly typertRegistration = inject(Typert);

  /** 测试与装配面的覆盖值（`Object.assign` 写它）。`declare`：不产生运行时字段，`hasOwn` 才分得清"设过没有"。 */
  declare private typertOverride:
    | { remotes: { get(key: string): { mode?: string } | undefined } }
    | undefined;

  private get typert():
    | { remotes: { get(key: string): { mode?: string } | undefined } }
    | undefined {
    // 显式设过（哪怕设成 `undefined`）就以它为准：接缝测试用 `Object.assign` 关掉流式分流。
    if (Object.hasOwn(this, "typertOverride")) return this.typertOverride;
    // `inject` 是惰性 Proxy，**读属性时才抛**（没有提供者的接缝测试）；探一下让抛错落在本 try 内。
    try {
      const registry = this.typertRegistration as unknown as
        | { remotes: { get(key: string): { mode?: string } | undefined } }
        | undefined;
      void registry?.remotes;
      return registry;
    } catch {
      return undefined;
    }
  }

  /**
   * 上游分派要的调用方身份。
   *
   * **`kind: 'owner'`**：这条 mux 是本机宿主自己的界面通道（桌面/本地 web），浏览器就是宿主的窗口，
   * 不是外部调用者。`remote-access` 对 `owner` 走 baseline 直接放行；写成 `browser` 就必须
   * 注册一条 `registerPolicy('browser', …)`，否则每个端点都抛
   * `remote access: session/list: access denied (no-allow)`——装配成功但一个端点都调不动。
   */
  private readonly peer = {
    id: "host",
    signal: new AbortController().signal,
    interactions: "answer",
    principal: { kind: "owner" },
  };

  private readonly webServer = inject(WebServer);

  private readonly logger = inject(Logger);

  private disposeRoute: (() => void) | undefined;

  /** 在途的 unary 调用数（服务端"忙不忙"的一半判据）。 */
  private inFlightCalls = 0;

  /** 开着的逻辑流（另一半判据，见 `inFlight`）。 */
  private readonly liveStreams = new Set<AbortController>();

  /**
   * 服务端此刻是否**空闲**：没有在途 unary、没有开着的流。
   *
   * 开发态的**服务端 HMR** 靠它决定"现在能不能 reload"——有在途调用时换掉整棵行树，
   * 那条请求会拿到半新半旧的对象图，比直接报错更难查。判据只算**传输层的在途**：
   * 会话里正在跑的 turn 属于业务状态，由调用方自己再看（见 `ServerHmr`）。
   * @returns 空闲为 `true`。
   */
  inFlight(): number {
    return this.inFlightCalls + this.liveStreams.size;
  }

  onInit(): void {
    this.disposeRoute = this.webServer.registerUpgrade({
      path: MUX_PATH,
      handler: (req, socket, head) => {
        this.accept(req, socket, head);
      },
    });
  }

  onDispose(): void {
    this.disposeRoute?.();
    this.disposeRoute = undefined;
  }

  /** 完成握手，然后把这条 socket 当成一条 mux 通道。 */
  private accept(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    let buffer: Buffer = head.length === 0 ? Buffer.alloc(0) : Buffer.from(head);
    /** 这条 socket 上还开着的逻辑流：socket 关闭时一并取消。 */
    const live = new Map<string, AbortController>();
    /** 客户端 → 宿主的上行队列（双向流用；只下行的流里没有条目）。 */
    const uplinks = new Map<string, UplinkQueue>();
    socket.once("close", () => {
      for (const controller of live.values()) controller.abort(new Error("mux socket closed"));
      live.clear();
    });
    const drain = (): void => {
      for (;;) {
        const frame = readFrame(buffer);
        if (frame === undefined) return;
        buffer = buffer.subarray(consumedOf(frame));
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode !== 0x1) continue;
        // **必须**接住：`void` 掉的 promise 一旦 reject，就是进程级的未捕获拒绝（Node 默认退出进程）。
        // 客户端断开、路由表里某个 handler 同步抛、帧序列化失败都会走到这里。
        void this.dispatch(socket, frame.payload.toString("utf8"), live, uplinks).catch(
          (error: unknown) => {
            this.logger.warn("[mux] 分派一帧失败：%s", String(error));
          },
        );
      }
    };
    socket.on("data", (chunk: Buffer) => {
      buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
      drain();
    });
    socket.on("error", () => {
      socket.destroy();
    });
    drain();
  }

  /** 处理一条客户端消息（`open` / `item` / `end` / `cancel`）。 */
  private async dispatch(
    socket: Duplex,
    text: string,
    live: Map<string, AbortController>,
    uplinks: Map<string, UplinkQueue>,
  ): Promise<void> {
    let message: {
      type?: string;
      streamId?: string;
      endpoint?: string;
      payload?: unknown;
      value?: unknown;
    };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    const streamId = message.streamId;
    if (typeof streamId !== "string") return;
    if (message.type === "cancel") {
      live.get(streamId)?.abort(new Error("mux stream cancelled"));
      return;
    }
    // 上行：`item` 是客户端发来的一条（终端的键入），`end` 是半关。没有对应流的帧直接丢。
    if (message.type === "item") {
      uplinks.get(streamId)?.push(message.value);
      return;
    }
    if (message.type === "end") {
      uplinks.get(streamId)?.end();
      uplinks.delete(streamId);
      return;
    }
    if (message.type !== "open") return;

    const endpoint = message.endpoint ?? "";
    if (endpoint === "$events") {
      // 事件流：把路由表上的每一帧转成 `item`，连接断开时退订。
      // 事实型观测：订阅时的 streamId 与频道名列表本身，不是「订阅了几个」这种总结。
      this.logger.debug("[mux] subscribe streamId=%s channels=%j", streamId, [
        ...FORWARDED_CHANNELS,
      ]);
      const offs = new Map<string, () => void>();
      for (const channel of FORWARDED_CHANNELS) {
        offs.set(
          channel,
          this.handlers.subscribe(channel, (...args) => {
            // 监听器是**同步**从 cordis 事件处理器里调的（见 `ForwardedEventsBridge`）：序列化或写帧一抛，
            // 异常就落进发布方的调用栈（agent loop 的异步路径），升级成进程退出。这里一律吞成一条日志。
            try {
              writeText(
                socket,
                JSON.stringify({ type: "item", streamId, value: { channel, args } }),
              );
            } catch (error) {
              this.logger.warn("[mux] 转发事件 %s 失败：%s", channel, String(error));
            }
          }),
        );
      }
      socket.once("close", () => {
        for (const off of offs.values()) off();
        offs.clear();
      });
      return;
    }
    const separator = endpoint.indexOf("/");
    if (separator <= 0) {
      this.fail(socket, streamId, "gateway/bad-request", `endpoint 不合法：${endpoint}`);
      return;
    }
    const args = (message.payload as { args?: Record<string, unknown> } | undefined)?.args ?? {};
    // 流式方法先查路由表：`follow` 这类要逐帧回，不能当 unary 等一个最终值。
    const controller = new AbortController();
    // 分派顺序：**自研路由表**（同步就绪的帧序列）→ **上游流式端点**（`@Remote({ mode: "stream" })`
    // 必须走 gateway 的 stream 载具，用 unary 的 `invoke` 会得到
    // `stream Remote methods must be opened through the stream carrier`）→ unary。
    const uplink = createUplink();
    uplinks.set(streamId, uplink);
    let source: AsyncIterable<unknown> | Promise<AsyncIterable<unknown>> | undefined;
    try {
      source =
        this.handlers.stream(endpoint, args, controller.signal) ??
        this.upstreamStreamOf(endpoint, args, controller, uplink);
    } catch (error) {
      // 流式 handler 在**建立**时同步抛：按 unary 的失败口径回一帧 error，而不是让分派点 reject。
      uplinks.delete(streamId);
      uplink.end();
      this.logger.warn("[mux] %s 打开流失败：%s", endpoint, String(error));
      this.fail(socket, streamId, "gateway/invoke-failed", String(error));
      return;
    }
    if (source !== undefined) {
      live.set(streamId, controller);
      this.liveStreams.add(controller);
      void this.pump(socket, streamId, source, controller)
        .catch((error: unknown) => {
          // 同 `dispatch`：`void` 掉的 promise 必须接住，否则是进程级退出。
          this.logger.warn("[mux] 流 %s 收尾失败：%s", streamId, String(error));
        })
        .finally(() => {
          live.delete(streamId);
          uplinks.delete(streamId);
          this.liveStreams.delete(controller);
          uplink.end();
        });
      return;
    }
    uplinks.delete(streamId);
    try {
      // 先查我们的路由表（`session/page` 之外的少数自研端点），**没有实现才回落到上游 gateway**。
      // 不回落的话，上游那 199 条 `@Remote` 端点在真实链路上全都调不到——只有测试壳走过 fallback。
      this.inFlightCalls += 1;
      try {
        const value = await this.invokeWithFallback(endpoint, args);
        writeText(socket, JSON.stringify({ type: "item", streamId, value }));
        writeText(socket, JSON.stringify({ type: "end", streamId }));
      } finally {
        this.inFlightCalls -= 1;
      }
    } catch (error) {
      this.logger.warn("[mux] %s 调用失败：%s", endpoint, String(error));
      this.fail(socket, streamId, "gateway/invoke-failed", String(error));
    }
  }

  /**
   * 上游的**流式**端点：由 descriptor 的 `mode === "stream"` 判定。
   *
   * 判据必须来自 descriptor（`typert.remotes.get`），不能靠"调用失败再重试"——
   * 流一旦用 unary 打开就晚了（上游直接拒）。
   * @param endpoint - `namespace/method`。
   * @param args - wire 上的命名参数。
   * @param controller - 取消信号源。
   * @returns 帧序列的 Promise；不是上游流式端点时 `undefined`。
   */
  private upstreamStreamOf(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
    controller: AbortController,
    uplink: UplinkQueue,
  ): Promise<AsyncIterable<unknown>> | undefined {
    // `typert` 可选：只装 mux 的接缝测试没有注册表，那时上游流式端点不参与分流。
    const descriptor = this.typert?.remotes.get(endpoint);

    if (descriptor?.mode !== "stream") return undefined;
    const separator = endpoint.indexOf("/");
    return (
      this.gateway as unknown as {
        stream(request: unknown): Promise<AsyncIterable<unknown>>;
      }
    ).stream({
      namespace: endpoint.slice(0, separator),
      method: endpoint.slice(separator + 1),
      args,
      signal: controller.signal,
      peer: this.peer,
      // 上行：双向流（终端）靠它收客户端的键入。只下行的流读了也不会有人推，行为不变。
      uplink,
    });
  }

  /**
   * 先查我们的路由表，未实现时交给上游 `typertGateway`。
   *
   * 判据是 `RemoteHandlers` 的固定错误文案（`没有实现`）——那是"这张表里没有这条端点"的
   * 唯一信号；其余错误照原样抛，不能被 fallback 吞掉。
   * @param endpoint - `namespace/method`。
   * @param args - wire 上的命名参数。
   * @returns 端点结果。
   */
  private async invokeWithFallback(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    try {
      return await this.handlers.invoke(endpoint, args);
    } catch (error) {
      if (!/没有实现/.test(String(error))) throw error;
    }
    const separator = endpoint.indexOf("/");
    return await (this.gateway as { invoke(request: unknown): Promise<unknown> }).invoke({
      namespace: endpoint.slice(0, separator),
      method: endpoint.slice(separator + 1),
      args,
      peer: this.peer,
    } as never);
  }

  /**
   * 把一条流式方法的结果逐帧写回客户端。
   *
   * 取消（`cancel` 帧 / socket 关闭）时**不发** `end`：客户端已经不要这条流了，
   * 再发一帧结束等于替它宣告一个它没等到的事件。
   * @param socket - 对端 socket。
   * @param streamId - 客户端给这条逻辑流的 id。
   * @param source - 宿主侧的帧序列。
   * @param controller - 取消信号源。
   */
  private async pump(
    socket: Duplex,
    streamId: string,
    source: AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>,
    controller: AbortController,
  ): Promise<void> {
    try {
      // 上游的流要**先 await 打开**（`gateway.stream()` 是异步的），自研表给的是同步序列——
      // 两种都在这里统一成"逐帧取"。`pump` 本身是异步的，先打开不会阻塞分派点。
      for await (const value of await source) {
        if (controller.signal.aborted) return;
        writeText(socket, JSON.stringify({ type: "item", streamId, value }));
      }
      if (controller.signal.aborted) return;
      writeText(socket, JSON.stringify({ type: "end", streamId }));
    } catch (error) {
      if (controller.signal.aborted) return;
      this.logger.warn("[mux] stream %s 失败：%s", streamId, String(error));
      this.fail(socket, streamId, "gateway/invoke-failed", String(error));
    }
  }

  /** 回一帧错误。 */
  private fail(socket: Duplex, streamId: string, code: string, message: string): void {
    writeText(
      socket,
      JSON.stringify({ type: "error", streamId, error: { code, message, details: {} } }),
    );
  }
}

/** 一条逻辑流的**上行**队列：`dispatch` 推、gateway 的 `uplink()` 迭代读。 */
interface UplinkQueue extends AsyncIterable<unknown> {
  /** 推一条（流已关时丢弃）。 */
  push(value: unknown): void;

  /** 半关：迭代随之结束。 */
  end(): void;
}

/**
 * 建一条上行队列。
 * @returns 队列（既是 `AsyncIterable`，也有 `push` / `end`）。
 */
function createUplink(): UplinkQueue {
  const items: unknown[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const settle = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  return {
    push(value: unknown): void {
      if (closed) return;
      items.push(value);
      settle();
    },
    end(): void {
      if (closed) return;
      closed = true;
      settle();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      for (;;) {
        if (items.length > 0) {
          yield items.shift();
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
