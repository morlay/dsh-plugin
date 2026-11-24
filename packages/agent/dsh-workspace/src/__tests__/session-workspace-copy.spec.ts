// 跨工作区复制的**编排**（L2：workspace 域的宿主行 + 两个端口的替身/替身注册表）。
//
// 这条动作用两个能力：`SessionWorkspace`（本域：认目标目录 + attach）与 `SessionBranching`（数据面：
// 派生 + 补偿删除）。判据落在这三段：先认工作区再派生、attach 收到派生出来的子会话、
// attach 被拒时补偿删除已经跑过（复制要么落成、要么库里不多一条谁也找不到的会话）。
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/contract";
import {
  SessionBranching,
  SessionWorkspaceCopy,
  SessionWorkspaceCopyFailure,
  type SessionFork,
  type SessionForkOptions,
} from "@morlay/dsh-session";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { FakeWorkspaceRegistry, workspaceOf } from "@morlay/dsh-workspace/testing";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { SessionWorkspaceCopyHost } from "../server/session-workspace-copy.host.ts";
import { SessionWorkspaceHost } from "../server/session-workspace.host.ts";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";

// 数据面替身：只记下被派生了什么、被撤掉了什么；子会话 id 由它铸（真实现由 session-rdb 给）。
@Injectable()
class FakeBranching extends SessionBranching {
  readonly forks: Array<{ readonly source: string; readonly cwd?: string }> = [];

  readonly discarded: string[] = [];

  /** 补偿删除自己失败的那种情况（库里删不掉）。 */
  discardError: Error | undefined;

  async fork(sourceId: SessionId, options?: SessionForkOptions): Promise<SessionFork> {
    this.forks.push({
      source: String(sourceId),
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    const child = SessionId("child-" + String(this.forks.length));
    return {
      sessionId: child,
      discard: async (): Promise<void> => {
        this.discarded.push(String(child));
        if (this.discardError !== undefined) throw this.discardError;
      },
    };
  }
}

interface Handles {
  readonly copy: SessionWorkspaceCopy;
  readonly registry: FakeWorkspaceRegistry;
  readonly branching: FakeBranching;
  readonly dispose: () => Promise<void>;
}

// 真注册表替身 + 真的两行宿主（`SessionWorkspaceHost` / `SessionWorkspaceCopyHost`）：装配路径与生产同形。
//
// `onAttach` 给了就自己造一行（拒绝 attach 的路径），没给就走注册表的 `create`（它把 attach 记进 `attached`）。
async function start(onAttach?: () => void): Promise<Handles & { readonly targetId: string }> {
  const registry = new FakeWorkspaceRegistry();
  const targetPath = await realpath(await mkdtemp(join(tmpdir(), "workspace-copy-target-")));
  onTestFinished(() => rm(targetPath, { recursive: true, force: true }));
  if (onAttach === undefined) await registry.create(targetPath);
  else registry.rows.push(workspaceOf(targetPath, onAttach));
  const target = registry.rows[0]!;
  const app = await bootstrapApplication({
    providers: [
      { provide: WorkspaceRegistry, useValue: registry },
      WorkspaceBroadcaster,
      FakeBranching,
      SessionWorkspaceHost,
      SessionWorkspaceCopyHost,
    ],
    timeoutMs: 10_000,
  });
  onTestFinished(() => app.dispose().catch(() => undefined));
  return {
    copy: app.get(SessionWorkspaceCopy),
    registry,
    branching: app.get(SessionBranching) as FakeBranching,
    dispose: async (): Promise<void> => await app.dispose(),
    targetId: String(target.id),
  };
}

describe("跨工作区复制的编排", { timeout: 15_000 }, () => {
  test("派生到目标目录再挂上去：attach 收到子会话", async () => {
    const handles = await start();

    const copied = await handles.copy.copyToWorkspace("copy-source", handles.targetId);

    expect(copied).toEqual({ sessionId: "child-1", workspaceId: handles.targetId });
    // 派生拿的是目标工作区的路径（attach 会按 header cwd 校验归属）。
    expect(handles.branching.forks).toEqual([
      { source: "copy-source", cwd: handles.registry.rows[0]!.path },
    ]);
    expect(handles.registry.attached).toEqual([
      { workspaceId: handles.targetId, sessionId: "child-1" },
    ]);
    expect(handles.branching.discarded).toEqual([]);
  });

  test("目标不在注册表里：先拒、不派生（不留谁也不认识的子会话）", async () => {
    const handles = await start();

    const failure = await handles.copy
      .copyToWorkspace("copy-source", "w-absent")
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SessionWorkspaceCopyFailure);
    expect(failure).toMatchObject({ reason: "workspace-not-found" });
    expect(handles.branching.forks).toEqual([]);
    expect(handles.registry.attached).toEqual([]);
  });

  test("attach 被拒：先撤掉派生，再抛出带原因链的失败", async () => {
    const handles = await start(() => {
      throw new Error("workspace 拒绝了 attach");
    });

    const failure = await handles.copy
      .copyToWorkspace("copy-source", handles.targetId)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SessionWorkspaceCopyFailure);
    expect(failure).toMatchObject({ reason: "attach-rejected" });
    expect((failure as Error).message).toContain("workspace 拒绝了 attach");
    expect(handles.branching.discarded).toEqual(["child-1"]);
  });

  test("补偿删除也失败时两个失败都在原因链里（AggregateError）", async () => {
    const handles = await start(() => {
      throw new Error("workspace 拒绝了 attach");
    });
    handles.branching.discardError = new Error("派生会话删不掉");

    const failure = (await handles.copy
      .copyToWorkspace("copy-source", handles.targetId)
      .then(() => undefined)
      .catch((error: unknown) => error)) as Error;

    expect(failure).toBeInstanceOf(SessionWorkspaceCopyFailure);
    expect(failure.message).toContain("workspace 拒绝了 attach");
    expect(failure.message).toContain("派生会话删不掉");
    const cause = failure.cause as AggregateError;
    expect(cause).toBeInstanceOf(AggregateError);
    // 原始失败不能被「撤不干净」顶掉：两个都在，顺序是 [attach, 补偿删除]。
    expect(cause.errors.map((error: Error) => error.message)).toEqual([
      "workspace 拒绝了 attach",
      "派生会话删不掉",
    ]);
  });
});
