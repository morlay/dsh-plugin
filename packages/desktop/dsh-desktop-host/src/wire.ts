/**
 * 桌面 host 与 Electron 壳之间的字节管道协议：请求帧（壳 → host，FD 3）与响应帧（host → 壳，FD 4）。
 *
 * 帧头 13 字节：magic(4) | type(1) | streamId(4) | payloadLength(4)。data 帧是原始字节，
 * 其余帧是 JSON 或空载荷。两侧共用这一份实现，避免编解码各写一遍。
 */

export const DESKTOP_HOST_PROTOCOL_VERSION = 1 as const;

/** 桌面流的宿主路径：页面/主进程都用它（两侧共享一份，避免路径写两处）。 */
export const DESKTOP_STREAM_PATH = "/.dsh/remote-stream";

/** 壳写请求帧的管道描述符。 */
export const DESKTOP_REQUEST_PIPE_FD = 3;

/** host 写响应帧的管道描述符。 */
export const DESKTOP_RESPONSE_PIPE_FD = 4;

/** Node 生命周期 IPC 通道的描述符（ready / fatal / shutdown）。 */
export const DESKTOP_CONTROL_IPC_FD = 5;

/** 单个 data 帧携带的最大原始字节数。 */
export const DESKTOP_PIPE_CHUNK_BYTES = 64 * 1024;

const FRAME_MAGIC = 0x44534833;
const FRAME_HEADER_BYTES = 13;
const MAX_CONTROL_PAYLOAD_BYTES = 1024 * 1024;

const REQUEST_FRAME_START = 1;
const REQUEST_FRAME_DATA = 2;
const REQUEST_FRAME_END = 3;
const REQUEST_FRAME_CANCEL = 4;

const RESPONSE_FRAME_START = 1;
const RESPONSE_FRAME_DATA = 2;
const RESPONSE_FRAME_END = 3;
const RESPONSE_FRAME_ERROR = 4;

type FrameType = number;

/** 一个请求流开头的元数据。 */
export interface DesktopHostRequestStart {
  readonly url: string;
  readonly method: string;
  readonly headers: readonly [string, string][];
  readonly hasBody: boolean;
}

/** 一条校验过的请求帧。 */
export type DesktopHostRequestFrame =
  | ({ readonly type: "start"; readonly streamId: number } & DesktopHostRequestStart)
  | { readonly type: "data"; readonly streamId: number; readonly data: Buffer }
  | { readonly type: "end"; readonly streamId: number }
  | { readonly type: "cancel"; readonly streamId: number };

/** 一条校验过的响应帧。 */
export type DesktopHostResponseFrame =
  | {
      readonly type: "start";
      readonly streamId: number;
      readonly status: number;
      readonly headers: readonly [string, string][];
      readonly hasBody: boolean;
    }
  | { readonly type: "data"; readonly streamId: number; readonly data: Buffer }
  | { readonly type: "end"; readonly streamId: number }
  | { readonly type: "error"; readonly streamId: number; readonly message: string };

/** 仍留在 Node IPC 上的控制命令（不携带 Fetch 载荷字节）。 */
export type DesktopHostCommand = { readonly type: "shutdown" };

/** 仍留在 Node IPC 上的生命周期事件。 */
export type DesktopHostEvent =
  | { readonly type: "ready"; readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION }
  | { readonly type: "fatal"; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeaders(value: unknown): value is readonly [string, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (header) =>
        Array.isArray(header) &&
        header.length === 2 &&
        typeof header[0] === "string" &&
        typeof header[1] === "string",
    )
  );
}

function assertStreamId(streamId: number): void {
  if (!Number.isInteger(streamId) || streamId < 1 || streamId > 0xffff_ffff)
    throw new Error(`dsh desktop: invalid pipe stream id ${String(streamId)}`);
}

function encodeFrame(
  type: FrameType,
  streamId: number,
  payload: Buffer,
  dataType: FrameType,
  direction: string,
): Buffer {
  assertStreamId(streamId);
  const limit = type === dataType ? DESKTOP_PIPE_CHUNK_BYTES : MAX_CONTROL_PAYLOAD_BYTES;
  if (payload.byteLength > limit)
    throw new Error(`dsh desktop: ${direction} pipe frame exceeds the ${String(limit)}-byte limit`);
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.byteLength);
  frame.writeUInt32BE(FRAME_MAGIC, 0);
  frame.writeUInt8(type, 4);
  frame.writeUInt32BE(streamId, 5);
  frame.writeUInt32BE(payload.byteLength, 9);
  payload.copy(frame, FRAME_HEADER_BYTES);
  return frame;
}

function jsonPayload(
  type: FrameType,
  streamId: number,
  value: unknown,
  dataType: FrameType,
  direction: string,
): Buffer {
  return encodeFrame(
    type,
    streamId,
    Buffer.from(JSON.stringify(value), "utf8"),
    dataType,
    direction,
  );
}

/** 编码开启一个请求流的元数据帧（壳侧）。 */
export function encodeDesktopRequestStart(
  streamId: number,
  request: DesktopHostRequestStart,
): Buffer {
  return jsonPayload(REQUEST_FRAME_START, streamId, request, REQUEST_FRAME_DATA, "request");
}

/** 编码一个受限的请求体原始分片（壳侧）。 */
export function encodeDesktopRequestData(streamId: number, data: Uint8Array): Buffer {
  return encodeFrame(
    REQUEST_FRAME_DATA,
    streamId,
    Buffer.from(data),
    REQUEST_FRAME_DATA,
    "request",
  );
}

/** 编码请求体正常结束（壳侧）。 */
export function encodeDesktopRequestEnd(streamId: number): Buffer {
  return encodeFrame(REQUEST_FRAME_END, streamId, Buffer.alloc(0), REQUEST_FRAME_DATA, "request");
}

/** 编码取消一个请求及其响应（壳侧）。 */
export function encodeDesktopRequestCancel(streamId: number): Buffer {
  return encodeFrame(
    REQUEST_FRAME_CANCEL,
    streamId,
    Buffer.alloc(0),
    REQUEST_FRAME_DATA,
    "request",
  );
}

/** 编码响应元数据帧（host 侧）。 */
export function encodeDesktopResponseStart(
  streamId: number,
  response: {
    readonly status: number;
    readonly headers: readonly [string, string][];
    readonly hasBody: boolean;
  },
): Buffer {
  return jsonPayload(RESPONSE_FRAME_START, streamId, response, RESPONSE_FRAME_DATA, "response");
}

/** 编码一个受限的响应体原始分片（host 侧）。 */
export function encodeDesktopResponseData(streamId: number, data: Uint8Array): Buffer {
  return encodeFrame(
    RESPONSE_FRAME_DATA,
    streamId,
    Buffer.from(data),
    RESPONSE_FRAME_DATA,
    "response",
  );
}

/** 编码响应正常结束（host 侧）。 */
export function encodeDesktopResponseEnd(streamId: number): Buffer {
  return encodeFrame(
    RESPONSE_FRAME_END,
    streamId,
    Buffer.alloc(0),
    RESPONSE_FRAME_DATA,
    "response",
  );
}

/** 编码一次响应失败，不把 Error 对象跨进程传递（host 侧）。 */
export function encodeDesktopResponseError(streamId: number, message: string): Buffer {
  return jsonPayload(RESPONSE_FRAME_ERROR, streamId, { message }, RESPONSE_FRAME_DATA, "response");
}

function frameLength(buffer: Buffer, dataType: FrameType, direction: string): number | undefined {
  if (buffer.byteLength < FRAME_HEADER_BYTES) return undefined;
  if (buffer.readUInt32BE(0) !== FRAME_MAGIC)
    throw new Error(`dsh desktop: invalid ${direction} frame marker`);
  const type = buffer.readUInt8(4);
  const streamId = buffer.readUInt32BE(5);
  const payloadLength = buffer.readUInt32BE(9);
  assertStreamId(streamId);
  const limit = type === dataType ? DESKTOP_PIPE_CHUNK_BYTES : MAX_CONTROL_PAYLOAD_BYTES;
  if (payloadLength > limit)
    throw new Error(`dsh desktop: ${direction} frame exceeds the ${String(limit)}-byte limit`);
  const total = FRAME_HEADER_BYTES + payloadLength;
  return buffer.byteLength < total ? undefined : total;
}

function parseJson(payload: Buffer, subject: string): unknown {
  try {
    return JSON.parse(payload.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `dsh desktop: ${subject} payload is not JSON: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertEmpty(payload: Buffer, subject: string): void {
  if (payload.byteLength !== 0) throw new Error(`dsh desktop: ${subject} frame carried a payload`);
}

/** 增量解码 host 侧从请求管道收到的请求帧。 */
export class DesktopHostRequestDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** 追加字节并返回所有已完整的请求帧。 */
  push(chunk: Buffer): DesktopHostRequestFrame[] {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: DesktopHostRequestFrame[] = [];
    for (;;) {
      const frame = this.next();
      if (frame === undefined) return frames;
      frames.push(frame);
    }
  }

  /** EOF 落在帧中间时报错。 */
  finish(): void {
    if (this.buffer.byteLength !== 0)
      throw new Error("dsh desktop: request pipe ended inside a frame");
  }

  private next(): DesktopHostRequestFrame | undefined {
    const total = frameLength(this.buffer, REQUEST_FRAME_DATA, "request");
    if (total === undefined) return undefined;
    const type = this.buffer.readUInt8(4);
    const streamId = this.buffer.readUInt32BE(5);
    const payload = this.buffer.subarray(FRAME_HEADER_BYTES, total);
    this.buffer = this.buffer.subarray(total);
    switch (type) {
      case REQUEST_FRAME_START:
        return { type: "start", streamId, ...this.parseStart(payload) };
      case REQUEST_FRAME_DATA:
        return { type: "data", streamId, data: Buffer.from(payload) };
      case REQUEST_FRAME_END:
        assertEmpty(payload, "request end");
        return { type: "end", streamId };
      case REQUEST_FRAME_CANCEL:
        assertEmpty(payload, "request cancel");
        return { type: "cancel", streamId };
      default:
        throw new Error(`dsh desktop: unknown request frame type ${String(type)}`);
    }
  }

  private parseStart(payload: Buffer): DesktopHostRequestStart {
    const value = parseJson(payload, "request start");
    if (
      !isRecord(value) ||
      typeof value.url !== "string" ||
      typeof value.method !== "string" ||
      !isHeaders(value.headers) ||
      typeof value.hasBody !== "boolean"
    )
      throw new Error("dsh desktop: invalid request start payload");
    return {
      url: value.url,
      method: value.method,
      headers: value.headers,
      hasBody: value.hasBody,
    };
  }
}

/** 增量解码壳侧从响应管道收到的响应帧。 */
export class DesktopHostResponseDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** 追加字节并返回所有已完整的响应帧。 */
  push(chunk: Buffer): DesktopHostResponseFrame[] {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: DesktopHostResponseFrame[] = [];
    for (;;) {
      const frame = this.next();
      if (frame === undefined) return frames;
      frames.push(frame);
    }
  }

  /** EOF 落在帧中间时报错。 */
  finish(): void {
    if (this.buffer.byteLength !== 0)
      throw new Error("dsh desktop: response pipe ended inside a frame");
  }

  private next(): DesktopHostResponseFrame | undefined {
    const total = frameLength(this.buffer, RESPONSE_FRAME_DATA, "response");
    if (total === undefined) return undefined;
    const type = this.buffer.readUInt8(4);
    const streamId = this.buffer.readUInt32BE(5);
    const payload = this.buffer.subarray(FRAME_HEADER_BYTES, total);
    this.buffer = this.buffer.subarray(total);
    switch (type) {
      case RESPONSE_FRAME_START:
        return { type: "start", streamId, ...this.parseStart(payload) };
      case RESPONSE_FRAME_DATA:
        return { type: "data", streamId, data: Buffer.from(payload) };
      case RESPONSE_FRAME_END:
        assertEmpty(payload, "response end");
        return { type: "end", streamId };
      case RESPONSE_FRAME_ERROR:
        return { type: "error", streamId, ...this.parseError(payload) };
      default:
        throw new Error(`dsh desktop: unknown response frame type ${String(type)}`);
    }
  }

  private parseStart(
    payload: Buffer,
  ): Omit<Extract<DesktopHostResponseFrame, { type: "start" }>, "type" | "streamId"> {
    const value = parseJson(payload, "response start");
    if (
      !isRecord(value) ||
      !Number.isInteger(value.status) ||
      (value.status as number) < 100 ||
      (value.status as number) > 599 ||
      !isHeaders(value.headers) ||
      typeof value.hasBody !== "boolean"
    )
      throw new Error("dsh desktop: invalid response start payload");
    return {
      status: value.status as number,
      headers: value.headers,
      hasBody: value.hasBody,
    };
  }

  private parseError(payload: Buffer): { readonly message: string } {
    const value = parseJson(payload, "response error");
    if (!isRecord(value) || typeof value.message !== "string")
      throw new Error("dsh desktop: invalid response error payload");
    return { message: value.message };
  }
}

/** IPC 事件校验（壳侧）。 */
export function isDesktopHostEvent(value: unknown): value is DesktopHostEvent {
  if (!isRecord(value)) return false;
  if (value.type === "ready") return value.protocolVersion === DESKTOP_HOST_PROTOCOL_VERSION;
  if (value.type === "fatal") return typeof value.message === "string";
  return false;
}

/** IPC 命令校验（host 侧）。 */
export function isDesktopHostCommand(value: unknown): value is DesktopHostCommand {
  return isRecord(value) && value.type === "shutdown";
}
