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
import { inject, Injectable, Logger, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "./remote-handlers.contract.ts";
import { WebServer } from "../web/web-server.contract.ts";

/** mux 的路径（与客户端 `muxTransport` 一致）。 */
const MUX_PATH = "/api/remote.mux";

/**
 * 客户端可订阅的**转发事件频道**。
 *
 * 清单照抄上游 `api/remotes/src/remote-events.ts` 的 `API_REMOTE_FORWARDED_EVENTS`（上游的「唯一 home」）：
 * 少一条，那类变化就永远到不了页面。
 *
 * - `emit`：单向。**谁发**——宿主侧该域的服务用 `ctx.emit(name, …)`；**谁收**——浏览器半 `remote.$on(name, …)`。
 * - `waterfall`：需要应答。宿主用 `ctx.waterfall(name, request, next => …)` 发起，浏览器半的监听者**返回**
 *   `RemoteEventReply`（`result` / `next` / `rejected`）作为应答，宿主侧的 `next()` 据此继续。
 *
 * `resources`（上游用于多 Peer 访问控制）在本装配里不参与判定：本地单用户 mux 只有一个对端。
 */
const FORWARDED_EVENTS = [
  { event: "agent-preset/selected", mode: "emit" },
  { event: "approval/request", mode: "waterfall" },
  { event: "api-session/activity", mode: "emit" },
  { event: "api-session/added", mode: "emit" },
  { event: "api-session/error", mode: "emit" },
  { event: "api-session/removed", mode: "emit" },
  { event: "api-session/status", mode: "emit" },
  { event: "commands/change", mode: "emit" },
  { event: "deepseek-account/session-expired", mode: "emit" },
  { event: "deepseek-account/model-sign-in-required", mode: "emit" },
  { event: "credentials/record-updated", mode: "emit" },
  { event: "credentials/reference-updated", mode: "emit" },
  { event: "goal/activation-changed", mode: "emit" },
  { event: "cordis/request-run", mode: "emit" },
  { event: "cordis/request-run-resolved", mode: "emit" },
  { event: "cordis/dynamic-package", mode: "emit" },
  { event: "cordis/dynamic-retract", mode: "emit" },
  { event: "cordis/inspect-query", mode: "emit" },
  { event: "cordis/inspect-query-resolved", mode: "emit" },
  { event: "llm/adapters-updated", mode: "emit" },
  { event: "llm/models-updated", mode: "emit" },
  { event: "permission-presets/catalog-changed", mode: "emit" },
  { event: "plugin-manager/changed", mode: "emit" },
  { event: "plugin-manager/install-log", mode: "emit" },
  { event: "plugin-manager/install-state", mode: "emit" },
  { event: "plugin-manager/update-state", mode: "emit" },
  { event: "plugin-market/changed", mode: "emit" },
  { event: "settings/document-updated", mode: "emit" },
  { event: "schedule/changed", mode: "emit" },
  { event: "user-questions/request", mode: "waterfall" },
] as const;

/** 频道名的单一来源：订阅循环与推送都用它。 */
const FORWARDED_CHANNELS = FORWARDED_EVENTS.map((entry) => entry.event);

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
  socket.write(Buffer.concat([header, payload]));
}

@Injectable()
export class MuxServer implements OnDispose {
  /** Remote 方法的路由表：谁提供服务谁注册，不经过全局服务名。 */
  private readonly handlers = inject(RemoteHandlers);

  private readonly webServer = inject(WebServer);

  private readonly logger = inject(Logger);

  private disposeRoute: (() => void) | undefined;

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
        void this.dispatch(socket, frame.payload.toString("utf8"), live);
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
  private async dispatch(socket: Duplex, text: string, live: Map<string, AbortController>): Promise<void> {
    let message: { type?: string; streamId?: string; endpoint?: string; payload?: unknown };
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
    if (message.type !== "open") return;

    const endpoint = message.endpoint ?? "";
    if (endpoint === "$events") {
      // 事件流：把路由表上的每一帧转成 `item`，连接断开时退订。
      // 事实型观测：订阅时的 streamId 与频道名列表本身，不是「订阅了几个」这种总结。
      this.logger.debug("[mux] subscribe streamId=%s channels=%j", streamId, [...FORWARDED_CHANNELS]);
      const offs = new Map<string, () => void>();
      for (const channel of FORWARDED_CHANNELS) {
        offs.set(
          channel,
          this.handlers.subscribe(channel, (...args) => {
            writeText(socket, JSON.stringify({ type: "item", streamId, value: { channel, args } }));
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
    const source = this.handlers.stream(endpoint, args, controller.signal);
    if (source !== undefined) {
      live.set(streamId, controller);
      void this.pump(socket, streamId, source, controller).finally(() => {
        live.delete(streamId);
      });
      return;
    }
    try {
      const value = await this.handlers.invoke(endpoint, args);
      writeText(socket, JSON.stringify({ type: "item", streamId, value }));
      writeText(socket, JSON.stringify({ type: "end", streamId }));
    } catch (error) {
      this.logger.warn("[mux] %s 调用失败：%s", endpoint, String(error));
      this.fail(socket, streamId, "gateway/invoke-failed", String(error));
    }
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
    source: AsyncIterable<unknown>,
    controller: AbortController,
  ): Promise<void> {
    try {
      for await (const value of source) {
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
    writeText(socket, JSON.stringify({ type: "error", streamId, error: { code, message, details: {} } }));
  }
}
