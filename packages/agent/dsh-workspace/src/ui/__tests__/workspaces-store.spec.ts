// @vitest-environment happy-dom
/**
 * `WorkspaceController` 的局部闭环：**客户端用 mock 宿主**（`FakeRemote` 提供 `workspace/follow` 帧与命令应答）。
 *
 * 守两件事：首帧 baseline 写进 store（`ui-workspace` 的 `useWorkspaces` 就是读它），
 * 以及 `create` 走 `remote.workspace.create` 并把 `RemoteResult` 解成 `WorkspaceView`。
 * 断言全部经 `WorkspaceController` 契约（`list` 快照 / `create` 返回值）。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { WorkspaceController } from "../workspace-controller.contract.ts";
import { WorkspaceControllerDefault } from "../workspace-controller.service.ts";
import { FakeRemote } from "./support/fake-remote.ts";

type MockHandlers = Parameters<typeof mockTransport>[0];
type MockStreams = Parameters<typeof mockTransport>[1];

/**
 * 建好 client 半：真 `WorkspaceController` + 假传输。
 * @param streams - `workspace/follow` 的帧序列提供者。
 * @param handlers - 命令（`workspace/create`）的应答表。
 * @returns 应用与契约实例。
 */
async function boot(
  streams: MockStreams,
  handlers: MockHandlers = {},
): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  workspaces: WorkspaceController;
}> {
  FakeRemote.next = { handlers, streams };
  const app = await bootstrapApplication({
    providers: [FakeRemote, WorkspaceControllerDefault],
    timeoutMs: 15_000,
  });
  return { app, workspaces: app.get(WorkspaceController) };
}

/** 等 store 满足条件（follow 是异步接上的，别用固定时长猜）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("WorkspaceController", { timeout: 15_000 }, () => {
  it("follow 的首帧 baseline 写进 store（items / phase）", async () => {
    const { app, workspaces } = await boot({
      "workspace/follow": async function* () {
        yield {
          type: "baseline",
          value: {
            items: [
              {
                workspaceId: "w1",
                path: "/tmp/w",
                title: "工作区一",
                sessionIds: ["s1"],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            archivedSessionIds: [],
            pinnedSessionIds: [],
          },
        };
        // 保持流打开：真实的 follow 是长连接，客户端不该把「暂时没有增量」当成结束。
        await new Promise(() => {});
      },
    });
    try {
      await until(() => workspaces.list.getSnapshot().items.length > 0);
      expect(workspaces.list.getSnapshot().items.map((item) => item.workspaceId)).toEqual(["w1"]);
      expect(workspaces.list.getSnapshot().phase).toBe("ready");
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("增量帧（upsert）合并进 store", async () => {
    const { app, workspaces } = await boot({
      "workspace/follow": async function* () {
        yield {
          type: "baseline",
          value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
        };
        yield {
          type: "upsert",
          workspace: {
            workspaceId: "w2",
            path: "/tmp/w2",
            title: "后加的",
            sessionIds: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
        await new Promise(() => {});
      },
    });
    try {
      await until(() => workspaces.list.getSnapshot().items.length > 0);
      expect(workspaces.list.getSnapshot().items.map((item) => item.workspaceId)).toEqual(["w2"]);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("create 走 remote.workspace.create，并把 RemoteResult 解成 WorkspaceView", async () => {
    const created = {
      workspaceId: "w3",
      path: "/tmp/w3",
      title: "新工作区",
      sessionIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    let payload: unknown;
    const { app, workspaces } = await boot(
      {
        "workspace/follow": async function* () {
          yield {
            type: "baseline",
            value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
          };
          await new Promise(() => {});
        },
      },
      {
        "workspace/create": (args) => {
          payload = args;
          return { ok: true, value: { workspace: created, created: true } };
        },
      },
    );
    try {
      await expect(workspaces.create({ path: "/tmp/w3" })).resolves.toEqual(created);
      // 本行的职责是「把输入交给 `remote.workspace.create`」；命名参数包装在真 `RemoteDefault` 的
      // Proxy 里（替身按传输契约原样透传实参）。
      expect(payload).toEqual({ args: { path: "/tmp/w3" } });
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
