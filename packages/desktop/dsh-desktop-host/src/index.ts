/**
 * 桌面部署里的 host 进程入口：按 `desktop` profile 装配 Web 应用，并把请求经字节管道
 * （FD 3/4）交给宿主内的无端口 `webServer`。
 *
 * argv：`[runtimeDir, projectDir, primaryRuntime, pnpmEntry?, nodeBin?]`；
 * IPC：`ready` / `fatal`，另收 `shutdown`。
 */

import { once } from "node:events";
import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayeredEnv, loadProfileDirectory } from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";
import type {} from "@deepseek-ai/dsh-api-gateway";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import * as desktopOffice from "./office.ts";
import {
  DESKTOP_STREAM_PATH,
  installDesktopTransport,
  takeOverDesktopAuthentication,
} from "./transport.ts";
import { PortlessWebServer } from "./webserver.ts";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  isDesktopHostCommand,
  type DesktopHostEvent,
  type DesktopHostRequestFrame,
} from "./wire.ts";

const DESKTOP_PATCH = fileURLToPath(new URL("../config/desktop.cordis.patch.yml", import.meta.url));

interface PendingRequest {
  readonly abort: AbortController;
  body?: ReadableStreamDefaultController<Uint8Array>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const runtimeDir = process.argv[2];
  const projectDir = process.argv[3];
  if (runtimeDir === undefined || projectDir === undefined || process.send === undefined)
    throw new Error(
      "dsh desktop: expected runtime and profile directories, byte pipes, and a Node IPC channel",
    );
  const primaryRuntime = process.argv[4] ?? join(runtimeDir, "..", "runtime", "primary-runtime");
  const pnpmEntry = process.argv[5];
  const nodeBin = process.argv[6];

  const requestPipe: ReadStream = createReadStream("", {
    fd: DESKTOP_REQUEST_PIPE_FD,
    autoClose: false,
  });
  const responsePipe: WriteStream = createWriteStream("", {
    fd: DESKTOP_RESPONSE_PIPE_FD,
    autoClose: false,
  });
  let responseTail: Promise<void> = Promise.resolve();
  // 收尾阶段壳会关掉管道；此后不再写入，管道本身的错误也只在那一段里吞掉。
  let closing = false;
  responsePipe.on("error", (error) => {
    if (!closing) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  const writeResponse = (frame: Buffer): Promise<void> => {
    if (closing || responsePipe.destroyed) return Promise.resolve();
    const write = responseTail.then(async () => {
      if (closing || responsePipe.destroyed) return;
      if (!responsePipe.write(frame)) await once(responsePipe, "drain");
    });
    responseTail = write.catch(() => undefined);
    return write;
  };
  const send = (event: DesktopHostEvent): void => {
    if (process.send === undefined || !process.connected) return;
    try {
      process.send(event);
    } catch (error) {
      // 父进程并发断开时只吞掉通道已关闭这一种；其余照常抛出。
      if ((error as NodeJS.ErrnoException).code !== "ERR_IPC_CHANNEL_CLOSED") throw error;
    }
  };

  const installAnchor = join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
  const profile = loadProfileDirectory("dsh", projectDir, installAnchor);
  const application = runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: "desktop",
    resolvedProfile: { profile, installAnchor },
    patchFiles: [DESKTOP_PATCH],
    args: ["--no-open"],
    ...(pnpmEntry === undefined
      ? {}
      : {
          packageManager: {
            command: process.execPath,
            args: ["--expose-internals", pnpmEntry],
            env: {
              ELECTRON_RUN_AS_NODE: "1",
              DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
              PATH: `${nodeBin ?? ""}${nodeBin === undefined ? "" : ":"}${process.env.PATH ?? ""}`,
            },
          },
        }),
  });

  const { ctx } = await application;
  takeOverDesktopAuthentication(ctx);
  installDesktopTransport(ctx);
  await ctx.plugin(desktopOffice, {
    source: primaryRuntime,
    root: join(resolveDshHome(), "dsh-runtimes", "dsh-primary-runtime"),
  });
  const webServer = ctx.get("webServer") as unknown as PortlessWebServer;

  const pending = new Map<number, PendingRequest>();
  const runs = new Set<Promise<void>>();
  const decoder = new DesktopHostRequestDecoder();
  let lastStreamId = 0;
  let stopping: Promise<void> | undefined;

  const dispatch = async (
    streamId: number,
    request: Request,
    entry: PendingRequest,
  ): Promise<void> => {
    try {
      const response = await webServer.dispatch(request);
      await writeResponse(
        encodeDesktopResponseStart(streamId, {
          status: response.status,
          headers: [...response.headers.entries()],
          hasBody: response.body !== null,
        }),
      );
      if (response.body !== null) {
        for await (const chunk of response.body) {
          const bytes = Buffer.from(chunk);
          for (let offset = 0; offset < bytes.byteLength; offset += DESKTOP_PIPE_CHUNK_BYTES) {
            if (!pending.has(streamId)) return;
            await writeResponse(
              encodeDesktopResponseData(
                streamId,
                bytes.subarray(offset, offset + DESKTOP_PIPE_CHUNK_BYTES),
              ),
            );
          }
        }
      }
      await writeResponse(encodeDesktopResponseEnd(streamId));
    } catch (error) {
      if (!entry.abort.signal.aborted) {
        await writeResponse(encodeDesktopResponseError(streamId, errorMessage(error))).catch(
          () => {},
        );
      }
    } finally {
      pending.delete(streamId);
    }
  };

  const handleFrame = (frame: DesktopHostRequestFrame): void => {
    if (frame.type === "start") {
      if (frame.streamId <= lastStreamId)
        throw new Error(`dsh desktop: request stream ${String(frame.streamId)} is not in order`);
      lastStreamId = frame.streamId;
      const entry: PendingRequest = { abort: new AbortController() };
      const streamId = frame.streamId;
      const body = frame.hasBody
        ? new ReadableStream<Uint8Array>({
            start: (controller) => {
              entry.body = controller;
            },
            cancel: () => {
              entry.abort.abort();
            },
          })
        : undefined;
      pending.set(streamId, entry);
      const request = new Request(frame.url, {
        method: frame.method,
        headers: frame.headers,
        signal: entry.abort.signal,
        ...(body === undefined ? {} : { body, duplex: "half" }),
      } as RequestInit & { duplex?: "half" });
      const run = dispatch(streamId, request, entry).catch((error: unknown) => {
        ctx.logger.warn(error instanceof Error ? error : new Error(errorMessage(error)));
      });
      runs.add(run);
      void run.finally(() => runs.delete(run));
      return;
    }
    const entry = pending.get(frame.streamId);
    if (entry === undefined) return;
    switch (frame.type) {
      case "data": {
        // 桌面请求体很小，直接入队；不做管道 pause（pause 靠 body 流的 pull 恢复，
        // 一旦 body 提前销毁就再没人解除，会卡死后续请求帧）。
        entry.body?.enqueue(frame.data);
        return;
      }
      case "end":
        entry.body?.close();
        return;
      case "cancel":
        entry.abort.abort();
        return;
      default:
        return;
    }
  };

  const stop = (exitCode = 0): Promise<void> => {
    stopping ??= (async () => {
      closing = true;
      requestPipe.pause();
      requestPipe.destroy();
      for (const entry of pending.values()) entry.abort.abort();
      pending.clear();
      const running = await application.catch(() => undefined);
      await running?.shutdown.shutdown(exitCode);
      await Promise.allSettled(runs);
      await responseTail.catch(() => undefined);
      if (!responsePipe.destroyed) responsePipe.destroy();
      if (process.connected) process.disconnect?.();
      process.exitCode = exitCode;
    })();
    return stopping;
  };

  requestPipe.on("data", (chunk: Buffer) => {
    let frames: DesktopHostRequestFrame[];
    try {
      frames = decoder.push(chunk);
      for (const frame of frames) handleFrame(frame);
    } catch (error) {
      send({ type: "fatal", message: errorMessage(error) });
      void stop(1);
    }
  });
  requestPipe.once("error", (error) => {
    send({ type: "fatal", message: errorMessage(error) });
    void stop(1);
  });
  requestPipe.once("end", () => {
    try {
      decoder.finish();
    } catch (error) {
      send({ type: "fatal", message: errorMessage(error) });
      void stop(1);
    }
  });
  process.on("message", (message: unknown) => {
    if (isDesktopHostCommand(message)) void stop();
  });
  process.once("disconnect", () => {
    void stop();
  });

  const gateway = ctx.get("typertGateway");
  console.error(
    `[dsh-desktop] transport ready: webServer=${webServer.constructor.name} ` +
      `gateway=${gateway === undefined ? "missing" : "present"} ` +
      `streamRoute=${DESKTOP_STREAM_PATH}`,
  );
  send({ type: "ready", protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = errorMessage(error);
    if (process.send !== undefined && process.connected)
      process.send({ type: "fatal", message } satisfies DesktopHostEvent, (sendError) => {
        if (sendError !== null) console.error(sendError);
      });
    console.error(error);
    process.exitCode = 1;
    if (process.connected) process.disconnect?.();
  });
}
