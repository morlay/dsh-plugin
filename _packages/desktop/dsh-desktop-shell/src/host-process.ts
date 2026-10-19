import { appendFile } from "node:fs/promises";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  isDesktopHostEvent,
  type DesktopHostCommand,
  type DesktopHostEvent,
  type DesktopHostResponseFrame,
} from "@morlay/dsh-desktop-host/wire";

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
  /** 宿主进程内回环的 ws 端口（页面把 `ws://app/…` 重写到这里，见 `@morlay/dsh-desktop-host/ws-bridge`）。 */
  /** 宿主 webServer 的 origin（`http://127.0.0.1:<port>`）：窗口就是载入它。 */
  readonly origin: string;
}

// 后端调试端点的状态：`url` 为空表示没开（被关掉或开不起来，原因在 `message`）。
export type DesktopHostInspected = Extract<DesktopHostEvent, { type: "inspected" }>;

export type DesktopHostSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface DesktopHostOptions {
  /**
   * 宿主入口（绝对路径）：由壳按 node 的解析给出（`@morlay/dsh-desktop-host` 的 exports 指到
   * `src/index.ts`）。宿主由壳用 `--import` 挂着 TS loader 起，**两种形态都直接跑源码**——部署里不必再落
   * 一份 dist 载荷。
   */
  readonly entry: string;
  readonly nodeArgs?: readonly string[];

  readonly extraEnv?: Readonly<Record<string, string>>;

  readonly packageManager?: { readonly pnpm: string; readonly nodeBin: string };

  // 子进程在 `ps` 里的名字（`node --title`），由壳给成 `<app name>-server`。
  readonly processTitle?: string;

  readonly spawn?: DesktopHostSpawn;

  // host 非预期退出/管道断开时通知壳一次（壳据此拦截，别让页面停在半死状态）。
  readonly onFailure?: (error: Error) => void;

  /**
   * 宿主输出的落盘位置（壳给 `$DSH_HOME/logs/host.log`）。
   *
   * 打包形态下 GUI 的 stdout/stderr 没人看得到，而"某个 bundle/某一行没起来"的第一现场就在宿主这份输出里
   * ——不落盘就只能看到"服务少了"，看不到为什么。
   */
  readonly logFile?: string;
}

// 桌面 host 子进程：字节管道上的请求/响应载体（FD 3/4）+ Node IPC 生命周期。
export class DesktopHostProcess {
  private child: ChildProcess | undefined;
  private requestPipe: Writable | undefined;
  private responsePipe: Readable | undefined;
  private readonly responseDecoder = new DesktopHostResponseDecoder();
  private requestWriteTail: Promise<void> = Promise.resolve();
  private nextStreamId = 1;
  private readonly pending = new Map<number, PendingResponse>();
  private readonly blockedResponses = new Set<number>();
  private readonly inspectedListeners = new Set<(state: DesktopHostInspected) => void>();
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
    private readonly profileDir: string,
    private readonly inspectPort: number | undefined,
    private readonly options: DesktopHostOptions,
  ) {}

  // 启动子进程一次；`ready` 之后才解析。
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise;
    const entry = this.options.entry;
    const packageManager = this.options.packageManager;
    const args = [
      "--expose-internals",
      ...(this.options.processTitle === undefined ? [] : [`--title=${this.options.processTitle}`]),
      ...(this.inspectPort === undefined
        ? []
        : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
      ...(this.options.nodeArgs ?? []),
      entry,
      // 宿主入口的参数与 web 入口**同一套**（`@morlay/dsh-desktop-host` 的 `invocation.ts`）：壳只给
      // 两格锚点与包通道，形态自己的内层参数（`--no-open` 等）由宿主入口自己补——传参形状两边一致，
      // 才不会出现"dev 对、打包不对"这种只差一处的分歧。
      "--profile-dir",
      this.profileDir,
      "--runtime-dir",
      this.runtimeDir,
      ...(packageManager === undefined
        ? []
        : ["--pnpm", packageManager.pnpm, "--node-bin", packageManager.nodeBin]),
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
      cwd: this.profileDir,
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child = child;
    // 宿主输出除转发之外**再落一份盘**（见 `logFile`）：打包形态 GUI 里看不到 stdout/stderr，
    // 而"少服务"的原因只在宿主这份输出里。
    const persist = (chunk: string): void => {
      if (this.options.logFile === undefined) return;
      void appendFile(this.options.logFile, chunk).catch(() => undefined);
    };
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS);
      process.stderr.write(`[dsh-host] ${chunk}`);
      persist(chunk);
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      process.stdout.write(chunk);
      persist(chunk);
    });
    child.on("message", (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error("dsh desktop host sent an invalid IPC event"));
        this.killChild("SIGTERM");
        return;
      }
      if (message.type === "fatal") {
        // dialog 只显示 message；完整诊断（code / syscall / path / cause）写 stderr——
        // fatal 带可选 `diagnostic`；不接收就等于丢掉启动失败的根因。
        if (message.diagnostic !== undefined)
          process.stderr.write(`[dsh-host] ${message.diagnostic}\n`);
        this.fail(new Error(message.message));
        return;
      }
      if (message.type === "inspected") {
        for (const listener of this.inspectedListeners) listener(message);
        return;
      }
      this.readyResolve({
        protocolVersion: message.protocolVersion,
        origin: message.origin,
      });
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

  // 把一个应用协议请求（`<scheme>://app/*`）交给子进程，响应体边收边出。
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

  // 打开后端调试端点（`port` 为 0 表示由 host 挑一个随机端口）；端点经 `onInspected` 回报。
  inspect(port = 0): void {
    this.send({ type: "inspect", port });
  }

  // 关掉后端调试端点。
  endInspect(): void {
    this.send({ type: "inspect-off" });
  }

  // 订阅调试端点状态；返回退订。
  onInspected(listener: (state: DesktopHostInspected) => void): () => void {
    this.inspectedListeners.add(listener);
    return () => {
      this.inspectedListeners.delete(listener);
    };
  }

  // 请求优雅退出，再等子进程收尾。
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
        // 监听器自己抛错：这条通道可能已经坏了，记不了就只留一行 stderr。
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
