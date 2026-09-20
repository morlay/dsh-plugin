import { describe, expect, it } from "vitest";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DesktopHostRequestDecoder,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  isDesktopHostCommand,
  isDesktopHostEvent,
} from "../wire.ts";

function decodeRequests(...chunks: Buffer[]) {
  const decoder = new DesktopHostRequestDecoder();
  const frames = chunks.flatMap((chunk) => decoder.push(chunk));
  decoder.finish();
  return frames;
}

function decodeResponses(...chunks: Buffer[]) {
  const decoder = new DesktopHostResponseDecoder();
  const frames = chunks.flatMap((chunk) => decoder.push(chunk));
  decoder.finish();
  return frames;
}

describe("请求帧", () => {
  it("按序还原 start / data / end", () => {
    const frames = decodeRequests(
      Buffer.concat([
        encodeDesktopRequestStart(7, {
          url: "dsh-app://app/api/session",
          method: "POST",
          headers: [["content-type", "application/json"]],
          hasBody: true,
        }),
        encodeDesktopRequestData(7, Buffer.from("body")),
        encodeDesktopRequestEnd(7),
      ]),
    );
    expect(frames).toEqual([
      {
        type: "start",
        streamId: 7,
        url: "dsh-app://app/api/session",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      },
      { type: "data", streamId: 7, data: Buffer.from("body") },
      { type: "end", streamId: 7 },
    ]);
  });

  it("跨分片投递时按帧补齐", () => {
    const bytes = Buffer.concat([
      encodeDesktopRequestStart(1, {
        url: "dsh-app://app/",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
      encodeDesktopRequestCancel(1),
    ]);
    const decoder = new DesktopHostRequestDecoder();
    const frames = [];
    for (const byte of bytes) frames.push(...decoder.push(Buffer.from([byte])));
    decoder.finish();
    expect(frames.map((frame) => frame.type)).toEqual(["start", "cancel"]);
  });

  it("载荷长度错误的空帧与未知类型都报错", () => {
    const start = encodeDesktopRequestStart(1, {
      url: "dsh-app://app/",
      method: "GET",
      headers: [],
      hasBody: false,
    });
    const cancel = encodeDesktopRequestCancel(1);
    // 载荷长度字段被写成超过控制帧上限，解码要在读取前拒绝。
    const tampered = Buffer.from(cancel);
    tampered.writeUInt32BE(2 * 1024 * 1024, 9);
    expect(() => decodeRequests(Buffer.concat([start, tampered]))).toThrow(/exceeds/);

    const truncated = Buffer.from(cancel);
    truncated.writeUInt32BE(1, 9);
    expect(() => decodeRequests(Buffer.concat([start, truncated]))).toThrow(/inside a frame/);

    const unknown = Buffer.from(start);
    unknown.writeUInt8(9, 4);
    expect(() => decodeRequests(unknown)).toThrow(/unknown request frame type/);
  });

  it("EOF 落在帧中间时报错", () => {
    const decoder = new DesktopHostRequestDecoder();
    decoder.push(
      encodeDesktopRequestStart(1, {
        url: "dsh-app://app/",
        method: "GET",
        headers: [],
        hasBody: false,
      }).subarray(0, 8),
    );
    expect(() => decoder.finish()).toThrow(/inside a frame/);
  });

  it("data 帧超过单帧上限时编码报错", () => {
    expect(() => encodeDesktopRequestData(1, Buffer.alloc(DESKTOP_PIPE_CHUNK_BYTES + 1))).toThrow(
      /exceeds/,
    );
  });
});

describe("响应帧", () => {
  it("按序还原 start / data / end", () => {
    const frames = decodeResponses(
      Buffer.concat([
        encodeDesktopResponseStart(3, {
          status: 200,
          headers: [["content-type", "text/html"]],
          hasBody: true,
        }),
        encodeDesktopResponseData(3, Buffer.from("hi")),
        encodeDesktopResponseEnd(3),
      ]),
    );
    expect(frames).toEqual([
      {
        type: "start",
        streamId: 3,
        status: 200,
        headers: [["content-type", "text/html"]],
        hasBody: true,
      },
      { type: "data", streamId: 3, data: Buffer.from("hi") },
      { type: "end", streamId: 3 },
    ]);
  });

  it("错误帧携带消息", () => {
    expect(decodeResponses(encodeDesktopResponseError(4, "boom"))).toEqual([
      { type: "error", streamId: 4, message: "boom" },
    ]);
  });

  it("非法帧标记报错", () => {
    const bad = Buffer.from(encodeDesktopResponseEnd(1));
    bad.writeUInt32BE(0xdead_beef, 0);
    expect(() => decodeResponses(bad)).toThrow(/frame marker/);
  });
});

describe("IPC 契约", () => {
  it("只接受当前协议版本的 ready 与文本 fatal", () => {
    expect(
      isDesktopHostEvent({ type: "ready", protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION }),
    ).toBe(true);
    expect(isDesktopHostEvent({ type: "ready", protocolVersion: 99 })).toBe(false);
    expect(isDesktopHostEvent({ type: "fatal", message: "x" })).toBe(true);
    expect(isDesktopHostEvent({ type: "fatal" })).toBe(false);
    expect(isDesktopHostEvent("ready")).toBe(false);
  });

  it("只接受 shutdown 命令", () => {
    expect(isDesktopHostCommand({ type: "shutdown" })).toBe(true);
    expect(isDesktopHostCommand({ type: "update-tasks" })).toBe(false);
    expect(isDesktopHostCommand(null)).toBe(false);
  });
});
