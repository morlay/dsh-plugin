// `SessionWorkspaceHost`：会话创建落在哪个目录、建好后挂到哪个 workspace。
//
// 观察面是 **wire**（`workspace/follow` 的帧）：会话挂到 workspace 之后要有一条 `upsert`，
// 否则页面上那个工作区下不会出现新会话行。这样既不需要读 broadcaster 的实现，
// 也不需要知道帧是怎么被推出来的。
import { bootstrapApplication } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionWorkspace } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { afterEach, describe, expect, it } from "vitest";
import { SessionWorkspaceHost } from "../session-workspace.host.ts";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
import { WorkspaceControllerRow } from "../workspace-controller.host.ts";
import { FakeWorkspaceRegistry, workspaceOf } from "./support/fake-workspace-registry.ts";

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
}, 10_000);

/** 一条 follow 帧：本文件只读 `type` 与 `workspace.workspaceId`。 */
interface FollowFrame {
  readonly type?: string;
  readonly workspace?: { readonly workspaceId?: string };
}

/** wire 上的帧是 `unknown`；按判别式收窄，不靠类型断言。 */
function isFollowFrame(value: unknown): value is FollowFrame {
  return typeof value === "object" && value !== null && "type" in value;
}

/** 订阅 `workspace/follow`（经 wire），收集它推出来的帧。 */
class FollowProbe {
  readonly frames: FollowFrame[] = [];

  private readonly controller = new AbortController();

  constructor(handlers: RemoteHandlers) {
    const source = handlers.stream("workspace/follow", {}, this.controller.signal);
    if (source === undefined) return;
    const iterator = source[Symbol.asyncIterator]();
    void (async () => {
      for (;;) {
        const next = await iterator.next();
        if (next.done === true) return;
        if (isFollowFrame(next.value)) this.frames.push(next.value);
      }
    })();
  }

  /** 除 baseline 之外的增量帧。 */
  get upserts(): FollowFrame[] {
    return this.frames.slice(1);
  }

  stop(): void {
    this.controller.abort();
  }
}

async function boot(paths: string[]): Promise<{
  target: SessionWorkspace;
  registry: FakeWorkspaceRegistry;
  stream: FollowProbe;
}> {
  const app = await bootstrapApplication({
    // 真 broadcaster + 真 wire 行 + 假 registry：broadcast 通过活跃 follow 流观察。
    providers: [
      FakeWorkspaceRegistry,
      WorkspaceBroadcaster,
      SessionWorkspaceHost,
      RemoteHandlersDefault,
      WorkspaceControllerRow,
    ],
    timeoutMs: 8_000,
  });
  apps.push(app);
  const registry = app.get(FakeWorkspaceRegistry);
  for (const path of paths) {
    registry.rows.push(
      workspaceOf(path, (sessionId) => {
        registry.attached.push({ workspaceId: `w-${path}`, sessionId });
      }),
    );
  }
  return {
    target: app.get(SessionWorkspace),
    registry,
    stream: new FollowProbe(app.get(RemoteHandlers)),
  };
}

describe("SessionWorkspaceHost", { timeout: 10_000 }, () => {
  it("workspaceId：cwd 取 workspace 的路径，attach 落到 attachSession，并广播 upsert", async () => {
    const { target, registry } = await boot(["/tmp/w1"]);
    const [workspace] = registry.rows;
    const workspaceId = workspace?.id ?? "";
    const resolved = await target.resolve({ workspaceId });
    expect(resolved.cwd).toBe("/tmp/w1");
    await resolved.attach(SessionId("s1"));
    expect(registry.attached).toEqual([{ workspaceId, sessionId: "s1" }]);
  });

  it("attach 之后活跃的 follow 流收到这个 workspace 的 upsert", async () => {
    const { target, registry, stream } = await boot(["/tmp/w2"]);
    const [workspace] = registry.rows;
    const workspaceId = workspace?.id ?? "";

    // 先建立 baseline（首帧），再 attach，之后必须来一帧 upsert。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stream.frames[0]?.type).toBe("baseline");

    await (await target.resolve({ workspaceId })).attach(SessionId("s1"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stream.upserts.map((frame) => frame.workspace?.workspaceId)).toEqual([workspaceId]);
    stream.stop();
  });

  it("cwd：直接用调用方的目录，attach 是空动作", async () => {
    const { target, stream } = await boot([]);
    const resolved = await target.resolve({ cwd: "/tmp/custom" });
    expect(resolved.cwd).toBe("/tmp/custom");
    await resolved.attach(SessionId("s1"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stream.upserts).toEqual([]);
  });

  it("workspaceId 与 cwd 同时给：拒绝（与上游同序）", async () => {
    const { target } = await boot(["/tmp/w1"]);
    await expect(target.resolve({ workspaceId: "w1", cwd: "/tmp/x" })).rejects.toThrow(
      "accepts workspaceId or cwd, not both",
    );
  });

  it("workspace 不存在：报错", async () => {
    const { target } = await boot(["/tmp/w1"]);
    await expect(target.resolve({ workspaceId: "w-missing" })).rejects.toThrow(
      'workspace "w-missing" not found',
    );
  });
});
