import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseStart,
} from "@morlay/dsh-desktop-host/wire";
import { DesktopHostProcess, type DesktopHostOptions } from "../host-process.ts";

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly stdio: unknown;
}

interface FakeChild extends ChildProcess {
  readonly sent: unknown[];
  readonly requestPipe: PassThrough;
  readonly responsePipe: PassThrough;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const requestPipe = new PassThrough();
  const responsePipe = new PassThrough();
  Object.assign(child, {
    sent: [] as unknown[],
    requestPipe,
    responsePipe,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
    connected: true,
    kill: () => true,
    send: (message: unknown, callback?: (error: Error | null) => void) => {
      child.sent.push(message);
      callback?.(null);
      return true;
    },
  });
  Object.assign(child, {
    stdio: [null, null, null, requestPipe, responsePipe, null],
  });
  return child;
}

function harness(options: DesktopHostOptions = {}, inspectPort?: number) {
  const calls: SpawnCall[] = [];
  const child = fakeChild();
  const host = new DesktopHostProcess(
    "/runtime/node/node",
    "/app/seed",
    "/home/profiles/desktop",
    inspectPort,
    {
      ...options,
      spawn: ((command: string, args: readonly string[], spawnOptions: { cwd?: string }) => {
        calls.push({
          command,
          args,
          cwd: spawnOptions.cwd,
          stdio: (spawnOptions as { stdio?: unknown }).stdio,
        });
        return child;
      }) as never,
    },
  );
  return { calls, child, host };
}

const ENTRY = join("/app/seed", "node_modules", "@morlay", "dsh-desktop-host", "lib", "index.js");

function ready(child: FakeChild): void {
  child.emit("message", { type: "ready", protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION });
}

/** 从请求管道读到至少 count 条完整帧（帧写入跨 tick）。 */
async function readFrames(
  child: FakeChild,
  decoder: DesktopHostRequestDecoder,
  count: number,
): Promise<ReturnType<DesktopHostRequestDecoder["push"]>> {
  const frames: ReturnType<DesktopHostRequestDecoder["push"]> = [];
  for (let attempt = 0; attempt < 100 && frames.length < count; attempt += 1) {
    const chunk = child.requestPipe.read() as Buffer | null;
    if (chunk !== null) frames.push(...decoder.push(chunk));
    else await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return frames;
}

describe("桌面 host 子进程", () => {
  it("按管道形态启动：入口路径、argv 顺序与五元组 stdio", async () => {
    const { calls, child, host } = harness(
      {
        primaryRuntime: "/app/runtime/primary-runtime",
        profileResolution: "runtime",
        packageManager: { pnpm: "/app/runtime/pnpm/bin/pnpm.mjs", nodeBin: "/app/runtime/bin" },
        nodeArgs: ["--import=tsx/esm"],
      },
      9230,
    );
    const started = host.start();
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.command).toBe("/runtime/node/node");
    expect(call?.stdio).toEqual(["ignore", "pipe", "pipe", "pipe", "pipe", "ipc"]);
    expect(call?.cwd).toBe("/home/profiles/desktop");
    expect(call?.args.slice(0, 3)).toEqual([
      "--expose-internals",
      "--inspect=127.0.0.1:9230",
      "--import=tsx/esm",
    ]);
    expect(call?.args.slice(3)).toEqual([
      ENTRY,
      "/app/seed",
      "/home/profiles/desktop",
      "/app/runtime/primary-runtime",
      "runtime",
      "/app/runtime/pnpm/bin/pnpm.mjs",
      "/app/runtime/bin",
    ]);
    ready(child);
    await expect(started).resolves.toEqual({ protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION });
    const stopped = host.stop();
    child.emit("close", 0);
    await stopped;
  });

  it("processTitle 转成 node --title，进程在 ps 里可区分", async () => {
    const { calls, child, host } = harness({ processTitle: "dsh-custom-next-server" });
    const started = host.start();
    expect(calls[0]?.args.slice(0, 2)).toEqual([
      "--expose-internals",
      "--title=dsh-custom-next-server",
    ]);
    ready(child);
    await started;
    const stopped = host.stop();
    child.emit("close", 0);
    await stopped;
  });

  it("ready 之前报 fatal 时启动失败", async () => {
    const { child, host } = harness();
    const started = host.start();
    child.emit("message", { type: "fatal", message: "composition exploded" });
    await expect(started).rejects.toThrow("composition exploded");
  });

  it("GET 请求写出 start 帧并把响应解码成 Response", async () => {
    const { child, host } = harness();
    const started = host.start();
    ready(child);
    await started;

    const pending = host.fetch(new Request("dsh-app://app/api/list"));
    const frames = await readFrames(child, new DesktopHostRequestDecoder(), 1);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: "start",
      streamId: 1,
      url: "dsh-app://app/api/list",
      method: "GET",
      hasBody: false,
    });

    child.responsePipe.write(
      encodeDesktopResponseStart(1, {
        status: 200,
        headers: [["content-type", "application/json"]],
        hasBody: true,
      }),
    );
    child.responsePipe.write(encodeDesktopResponseData(1, Buffer.from("[1]")));
    child.responsePipe.write(encodeDesktopResponseEnd(1));

    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.text()).resolves.toBe("[1]");
    const stopped = host.stop();
    child.emit("close", 0);
    await stopped;
  });

  it("带 body 的请求写出 data 与 end 帧", async () => {
    const { child, host } = harness();
    const started = host.start();
    ready(child);
    await started;

    const pending = host.fetch(
      new Request("dsh-app://app/api/save", { method: "POST", body: "payload" }),
    );
    const frames = await readFrames(child, new DesktopHostRequestDecoder(), 3);
    expect(frames.map((frame) => frame.type)).toEqual(["start", "data", "end"]);
    expect(frames[0]).toMatchObject({ method: "POST", hasBody: true });
    expect((frames[1] as { data: Buffer }).data.toString()).toBe("payload");

    child.responsePipe.write(
      encodeDesktopResponseStart(1, { status: 204, headers: [], hasBody: false }),
    );
    child.responsePipe.write(encodeDesktopResponseEnd(1));
    expect((await pending).status).toBe(204);
    const stopped = host.stop();
    child.emit("close", 0);
    await stopped;
  });

  it("stop 通过 IPC 请求收尾并关掉请求管道写端", async () => {
    const { child, host } = harness();
    const started = host.start();
    ready(child);
    await started;
    const stopped = host.stop();
    child.emit("close", 0);
    await stopped;
    expect(child.sent).toEqual([{ type: "shutdown" }]);
    expect(child.requestPipe.destroyed).toBe(true);
  });
});
