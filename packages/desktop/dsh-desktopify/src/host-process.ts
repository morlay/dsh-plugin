import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  isDesktopHostEvent,
  type DesktopHostCommand,
  type DesktopHostResponseFrame,
} from "@morlay/dsh-desktop-host/wire";
import { DESKTOP_HOST_PACKAGE } from "./official.ts";

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024;

interface PendingResponse {
  readonly resolve: (response: Response) => void;
  readonly reject: (error: Error) => void;
  responseStarted: boolean;
  uploadOpen: boolean;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  requestReader?: ReadableStreamDefaultReader<Uint8Array>;
  removeAbort?: () => void;
}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, milliseconds);
    timer.unref();
  });
  try {
    return await Promise.race([exit.then(() => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface DesktopHostReady {
  readonly protocolVersion: number;
}

export type DesktopHostSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface DesktopHostOptions {
  readonly nodeArgs?: readonly string[];

  readonly extraEnv?: Readonly<Record<string, string>>;

  readonly primaryRuntime?: string;

  readonly profileResolution?: "link" | "runtime";

  readonly packageManager?: { readonly pnpm: string; readonly nodeBin: string };

  readonly spawn?: DesktopHostSpawn;

  /** host 非预期退出/管道断开时通知壳一次（壳据此拦截，别让页面停在半死状态）。 */
  readonly onFailure?: (error: Error) => void;
}

/** 桌面 host 子进程：字节管道上的请求/响应载体（FD 3/4）+ Node IPC 生命周期。 */
export class DesktopHostProcess {
  private child: ChildProcess | undefined;
  private requestPipe: Writable | undefined;
  private responsePipe: Readable | undefined;
  private readonly responseDecoder = new DesktopHostResponseDecoder();
  private requestWriteTail: Promise<void> = Promise.resolve();
  private nextStreamId = 1;
  private readonly pending = new Map<number, PendingResponse>();
  private readonly blockedResponses = new Set<number>();
  private readyResolve!: (ready: DesktopHostReady) => void;
  private readyReject!: (error: Error) => void;
  private readonly readyPromise = new Promise<DesktopHostReady>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });
  private exitPromise: Promise<void> | undefined;
  private stderr = "";
  private failureReported = false;
  private stopping = false;

  constructor(
    private readonly node: string,
    private readonly runtimeDir: string,
    private readonly projectDir: string,
    private readonly inspectPort?: number,
    private readonly options: DesktopHostOptions = {},
  ) {}

  /** 启动子进程一次；`ready` 之后才解析。 */
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise;
    // 部署里的 host 是工具自己的变体包（@morlay/dsh-desktop-host），落位名字与入口路径都要对上。
    const entry = join(
      this.runtimeDir,
      "node_modules",
      ...DESKTOP_HOST_PACKAGE.split("/"),
      "lib",
      "index.js",
    );
    const primaryRuntime =
      this.options.primaryRuntime ?? join(this.runtimeDir, "..", "runtime", "primary-runtime");
    const packageManager = this.options.packageManager;
    const args = [
      "--expose-internals",
      ...(this.inspectPort === undefined
        ? []
        : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
      ...(this.options.nodeArgs ?? []),
      entry,
      this.runtimeDir,
      this.projectDir,
      primaryRuntime,
      this.options.profileResolution ?? "link",
      ...(packageManager === undefined ? [] : [packageManager.pnpm, packageManager.nodeBin]),
    ];
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            name !== "NODE_OPTIONS" &&
            !name.startsWith("DSH_DESKTOP_") &&
            !/^(?:npm|pnpm|corepack)_/iu.test(name),
        ),
      ),
      ...this.options.extraEnv,
    };
    const spawnChild = this.options.spawn ?? spawn;
    const child = spawnChild(this.node, args, {
      cwd: this.projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "ipc"],
    });
    const requestPipe = child.stdio[DESKTOP_REQUEST_PIPE_FD];
    const responsePipe = child.stdio[DESKTOP_RESPONSE_PIPE_FD];
    if (!(requestPipe instanceof Writable) || !(responsePipe instanceof Readable)) {
      child.kill("SIGTERM");
      throw new Error("dsh desktop host did not expose the required byte pipes and IPC channel");
    }
    this.child = child;
    this.requestPipe = requestPipe;
    this.responsePipe = responsePipe;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS);
      process.stderr.write(`[dsh-host] ${chunk}`);
    });
    child.stdout?.pipe(process.stdout);
    responsePipe.on("data", (chunk: Buffer) => {
      this.acceptResponseBytes(chunk);
    });
    responsePipe.once("end", () => {
      try {
        this.responseDecoder.finish();
      } catch (error) {
        this.fail(errorOf(error, "dsh desktop host response pipe failed"));
        return;
      }
      this.fail(new Error("dsh desktop host response pipe ended"));
    });
    requestPipe.once("error", (error) => {
      this.fail(error);
    });
    responsePipe.once("error", (error) => {
      this.fail(error);
    });
    child.on("message", (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error("dsh desktop host sent an invalid IPC event"));
        this.killChild("SIGTERM");
        return;
      }
      if (message.type === "fatal") {
        this.fail(new Error(message.message));
        return;
      }
      this.readyResolve({ protocolVersion: message.protocolVersion });
    });
    child.once("error", (error) => {
      this.fail(error);
    });
    this.exitPromise = new Promise<void>((resolve) => {
      child.once("close", (code) => {
        const suffix = this.stderr.trim() === "" ? "" : `: ${this.stderr.trim()}`;
        if (code !== 0 && code !== null)
          this.fail(new Error(`dsh desktop host exited with ${String(code)}${suffix}`));
        else this.fail(new Error(`dsh desktop host stopped${suffix}`));
        resolve();
      });
    });
    return this.readyPromise;
  }

  /** 把一个 `dsh-app://` 请求交给子进程，响应体边收边出。 */
  async fetch(request: Request): Promise<Response> {
    await this.start();
    const child = this.child;
    if (child === undefined || !child.connected || this.requestPipe === undefined)
      throw new Error("dsh desktop host is unavailable");
    if (this.nextStreamId > 0xffff_ffff)
      throw new Error("dsh desktop host exhausted its request stream ids");
    const streamId = this.nextStreamId++;
    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;
    return new Promise<Response>((resolve, reject) => {
      const pending: PendingResponse = {
        resolve,
        reject,
        responseStarted: false,
        uploadOpen: hasBody,
      };
      const abort = (): void => {
        if (!this.pending.has(streamId)) return;
        const error = errorOf(request.signal.reason, "request aborted");
        pending.uploadOpen = false;
        void pending.requestReader?.cancel(error).catch(() => undefined);
        this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch(
          (pipeError: unknown) => {
            this.fail(errorOf(pipeError, "dsh desktop request pipe failed"));
          },
        );
        if (pending.controller === undefined) pending.reject(error);
        else pending.controller.error(error);
        this.finishPending(streamId, false);
      };
      if (request.signal.aborted) {
        reject(errorOf(request.signal.reason, "request aborted"));
        return;
      }
      request.signal.addEventListener("abort", abort, { once: true });
      pending.removeAbort = () => {
        request.signal.removeEventListener("abort", abort);
      };
      this.pending.set(streamId, pending);
      this.pumpRequest(streamId, request, hasBody).catch((error: unknown) => {
        this.failPending(streamId, errorOf(error, "dsh desktop request upload failed"));
      });
    });
  }

  /** 请求优雅退出，再等子进程收尾。 */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.stopping = true;
    this.blockedResponses.clear();
    this.responsePipe?.resume();
    if (child.connected) this.send({ type: "shutdown" });
    // 关掉父进程这一侧的写端，让 host 侧挂起的管道读在 Windows 上也能释放。
    this.requestPipe?.destroy();
    const exited = this.exitPromise ?? Promise.resolve();
    if (!(await exitsWithin(exited, 10_000))) this.killChild("SIGTERM");
    if (!(await exitsWithin(exited, 5_000))) {
      this.killChild("SIGKILL");
      if (!(await exitsWithin(exited, 5_000)))
        throw new Error("dsh desktop host did not exit after SIGKILL");
    }
    this.child = undefined;
    this.requestPipe = undefined;
    this.responsePipe = undefined;
  }

  private async pumpRequest(streamId: number, request: Request, hasBody: boolean): Promise<void> {
    await this.enqueueRequestFrame(
      encodeDesktopRequestStart(streamId, {
        url: request.url,
        method: request.method.toUpperCase(),
        headers: [...request.headers.entries()],
        hasBody,
      }),
    );
    if (!hasBody) return;
    const body = request.body;
    if (body === null) throw new Error("dsh desktop request body disappeared before upload");
    const reader = body.getReader();
    const pending = this.pending.get(streamId);
    if (pending === undefined) {
      await reader.cancel();
      return;
    }
    pending.requestReader = reader;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        for (let offset = 0; offset < next.value.byteLength; offset += DESKTOP_PIPE_CHUNK_BYTES) {
          if (!this.pending.has(streamId)) return;
          await this.enqueueRequestFrame(
            encodeDesktopRequestData(
              streamId,
              next.value.subarray(offset, offset + DESKTOP_PIPE_CHUNK_BYTES),
            ),
          );
        }
      }
      const live = this.pending.get(streamId);
      if (live !== undefined) {
        await this.enqueueRequestFrame(encodeDesktopRequestEnd(streamId));
        live.uploadOpen = false;
      }
    } finally {
      reader.releaseLock();
      const live = this.pending.get(streamId);
      if (live?.requestReader === reader) delete live.requestReader;
    }
  }

  private enqueueRequestFrame(frame: Buffer): Promise<void> {
    const write = this.requestWriteTail.then(async () => {
      const pipe = this.requestPipe;
      if (pipe === undefined || pipe.destroyed)
        throw new Error("dsh desktop host request pipe is unavailable");
      if (!pipe.write(frame)) await once(pipe, "drain");
    });
    this.requestWriteTail = write.catch(() => undefined);
    return write;
  }

  private send(message: DesktopHostCommand): void {
    const child = this.child;
    if (child === undefined || !child.connected)
      throw new Error("dsh desktop host IPC is unavailable");
    child.send(message, (error) => {
      if (error !== null) this.fail(error);
    });
  }

  private acceptResponseBytes(chunk: Buffer): void {
    try {
      for (const frame of this.responseDecoder.push(chunk)) this.handleResponseFrame(frame);
    } catch (error) {
      this.fail(errorOf(error, "dsh desktop host response pipe failed"));
      this.killChild("SIGTERM");
    }
  }

  private handleResponseFrame(frame: DesktopHostResponseFrame): void {
    const pending = this.pending.get(frame.streamId);
    if (pending === undefined) {
      if (frame.streamId >= this.nextStreamId)
        throw new Error(`dsh desktop host responded for unknown stream ${String(frame.streamId)}`);
      return;
    }
    switch (frame.type) {
      case "start": {
        if (pending.responseStarted)
          throw new Error(`dsh desktop host started stream ${String(frame.streamId)} twice`);
        pending.responseStarted = true;
        let body: ReadableStream<Uint8Array> | null = null;
        if (frame.hasBody) {
          body = new ReadableStream<Uint8Array>({
            start: (controller) => {
              pending.controller = controller;
            },
            pull: () => {
              this.blockedResponses.delete(frame.streamId);
              this.resumeResponsePipe();
            },
            cancel: (reason) => {
              this.cancelResponse(frame.streamId, reason);
            },
          });
        }
        pending.resolve(
          new Response(body, {
            status: frame.status,
            headers: new Headers(frame.headers.map(([name, value]) => [name, value])),
          }),
        );
        return;
      }
      case "data": {
        const controller = pending.controller;
        if (!pending.responseStarted || controller === undefined)
          throw new Error(
            `dsh desktop host sent body data before a body start for stream ${String(frame.streamId)}`,
          );
        controller.enqueue(frame.data);
        if ((controller.desiredSize ?? 0) <= 0) {
          this.blockedResponses.add(frame.streamId);
          this.responsePipe?.pause();
        }
        return;
      }
      case "end":
        if (!pending.responseStarted)
          throw new Error(
            `dsh desktop host ended stream ${String(frame.streamId)} before its response start`,
          );
        pending.controller?.close();
        this.finishPending(frame.streamId, true);
        return;
      case "error":
        this.failPending(frame.streamId, new Error(frame.message));
        return;
      default:
        return;
    }
  }

  private cancelResponse(streamId: number, reason: unknown): void {
    const pending = this.pending.get(streamId);
    if (pending === undefined) return;
    pending.uploadOpen = false;
    void pending.requestReader?.cancel(reason).catch(() => undefined);
    this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((error: unknown) => {
      this.fail(errorOf(error, "dsh desktop request pipe failed"));
    });
    this.finishPending(streamId, false);
  }

  private failPending(streamId: number, error: Error): void {
    const pending = this.pending.get(streamId);
    if (pending === undefined) return;
    pending.uploadOpen = false;
    void pending.requestReader?.cancel(error).catch(() => undefined);
    if (pending.controller === undefined) pending.reject(error);
    else pending.controller.error(error);
    this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((pipeError: unknown) => {
      this.fail(errorOf(pipeError, "dsh desktop request pipe failed"));
    });
    this.finishPending(streamId, false);
  }

  private finishPending(streamId: number, cancelOpenUpload: boolean): void {
    const pending = this.pending.get(streamId);
    if (pending === undefined) return;
    if (cancelOpenUpload && pending.uploadOpen) {
      pending.uploadOpen = false;
      void pending.requestReader?.cancel().catch(() => undefined);
      this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((error: unknown) => {
        this.fail(errorOf(error, "dsh desktop request pipe failed"));
      });
    }
    pending.removeAbort?.();
    this.pending.delete(streamId);
    this.blockedResponses.delete(streamId);
    this.resumeResponsePipe();
  }

  private resumeResponsePipe(): void {
    if (this.blockedResponses.size === 0) this.responsePipe?.resume();
  }

  private killChild(signal: NodeJS.Signals): void {
    const child = this.child;
    if (child === undefined || child.pid === undefined) return;
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    child.kill(signal);
  }

  private fail(error: Error): void {
    if (!this.stopping) this.readyReject(error);
    if (!this.failureReported && !this.stopping) {
      this.failureReported = true;
      try {
        this.options.onFailure?.(error);
      } catch (listenerError) {
        console.error(listenerError);
      }
    }
    // 收尾阶段（壳主动 stop）在途请求回 503 即可，别把管道关闭当异常抛给渲染进程。
    const closing = this.stopping;
    for (const pending of this.pending.values()) {
      void pending.requestReader?.cancel(error).catch(() => undefined);
      if (closing) {
        pending.resolve(new Response("desktop host is shutting down", { status: 503 }));
      } else if (pending.controller === undefined) pending.reject(error);
      else pending.controller.error(error);
      pending.removeAbort?.();
    }
    this.pending.clear();
    this.blockedResponses.clear();
    this.responsePipe?.resume();
  }
}

export { DESKTOP_HOST_PROTOCOL_VERSION };
