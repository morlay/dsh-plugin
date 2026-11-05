// @vitest-environment happy-dom
// 动作面闭环：列表 / 删除 / 导入 / 导出 / 整理 / 用量打在 `sessionAdmin` 组上，
// 归档与取消归档仍委托 `uiWorkspace`；成功路径刷新会话列表，失败路径带出宿主错误码。
import { bootstrapApplication } from "@morlay/zephyr";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import { Remote } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationManagerController,
  ConversationManagerRequestError,
} from "../conversation-manager.controller.ts";
import { SessionAdminEndpointClient } from "../session-admin-endpoint.client.ts";

interface Invocation {
  endpoint: string;
  args: Readonly<Record<string, unknown>>;
}

async function controllerWith(
  outcome: (endpoint: string) => Promise<unknown>,
  options: { workspace?: unknown; sessions?: unknown } = {},
): Promise<{
  face: ConversationManagerController["face"];
  calls: Invocation[];
  dispose: () => Promise<void>;
}> {
  const calls: Invocation[] = [];
  const remote = {
    invoke: async (endpoint: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ endpoint, args });
      return outcome(endpoint);
    },
  };
  const app = await bootstrapApplication({
    providers: [
      { provide: Remote as never, useValue: remote },
      {
        provide: UiWorkspace as never,
        useValue: options.workspace ?? {
          archiveSession: async () => undefined,
          unarchiveSession: async () => undefined,
        },
      },
      {
        provide: SessionController as never,
        useValue: options.sessions ?? { refresh: async () => undefined },
      },
      SessionAdminEndpointClient,
      ConversationManagerController,
    ],
    timeoutMs: 8_000,
  });
  return {
    face: app.get(ConversationManagerController).face,
    calls,
    dispose: () => app.dispose(),
  };
}

const ROWS = {
  ok: true,
  value: {
    total: 2,
    page: 1,
    pageSize: 20,
    items: [
      {
        sessionId: "s1",
        title: "留下的会话",
        origin: null,
        cwd: "/w",
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        workspace: "工作区一",
      },
      {
        sessionId: "s2",
        title: null,
        origin: "subagent",
        cwd: null,
        createdAt: 1,
        updatedAt: 3,
        archived: true,
        workspace: null,
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("对话管理动作面", () => {
  it("列表打 sessionAdmin/rows 并带回分页与行", async () => {
    const { face, calls, dispose } = await controllerWith(async () => ROWS);
    try {
      const page = await face.listRows({ page: 1, pageSize: 20 });
      expect(calls).toEqual([
        { endpoint: "sessionAdmin/rows", args: { request: { page: 1, pageSize: 20 } } },
      ]);
      expect(page.total).toBe(2);
      expect(page.items.map((row) => row.sessionId)).toEqual(["s1", "s2"]);
    } finally {
      await dispose();
    }
  });

  it("列表响应不可用时给出失败原因", async () => {
    const { face, dispose } = await controllerWith(async () => ({ ok: true, value: { total: 0 } }));
    try {
      await expect(face.listRows()).rejects.toThrow("会话列表响应不可用");
    } finally {
      await dispose();
    }
  });

  it("归档与取消归档委托 uiWorkspace", async () => {
    const archived: string[] = [];
    const unarchived: string[] = [];
    const { face, dispose } = await controllerWith(async () => ROWS, {
      workspace: {
        archiveSession: async (sessionId: string) => {
          archived.push(sessionId);
        },
        unarchiveSession: async (sessionId: string) => {
          unarchived.push(sessionId);
        },
      },
    });
    try {
      await face.archive("s1");
      await face.unarchive("s2");
      expect(archived).toEqual(["s1"]);
      expect(unarchived).toEqual(["s2"]);
    } finally {
      await dispose();
    }
  });

  it("删除打 sessionAdmin/delete 并刷新会话列表", async () => {
    const sessions = { refresh: vi.fn(async () => undefined) };
    const { face, calls, dispose } = await controllerWith(
      async () => ({ ok: true, value: { deleted: "s1" } }),
      { sessions },
    );
    try {
      await face.remove("s1");
      expect(calls).toEqual([
        { endpoint: "sessionAdmin/delete", args: { request: { sessionId: "s1" } } },
      ]);
      expect(sessions.refresh).toHaveBeenCalledTimes(1);
    } finally {
      await dispose();
    }
  });

  it("删除失败时带出宿主错误码且不刷新", async () => {
    const sessions = { refresh: vi.fn(async () => undefined) };
    const { face, dispose } = await controllerWith(
      async () => ({ ok: false, error: { code: "SESSION_NOT_ARCHIVED", message: "not archived" } }),
      { sessions },
    );
    try {
      await expect(face.remove("s1")).rejects.toBeInstanceOf(ConversationManagerRequestError);
      await expect(face.remove("s1")).rejects.toMatchObject({ code: "SESSION_NOT_ARCHIVED" });
      expect(sessions.refresh).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });

  it("导入 zip 走 base64 载荷并在导入后刷新", async () => {
    const sessions = { refresh: vi.fn(async () => undefined) };
    const { face, calls, dispose } = await controllerWith(
      async () => ({ ok: true, value: { sessionId: "session-imported" } }),
      { sessions },
    );
    try {
      const file = new File([new Uint8Array([1, 2, 3])], "session.zip", {
        type: "application/zip",
      });
      expect(await face.importZip(file)).toBe("session-imported");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.endpoint).toBe("sessionAdmin/import");
      const request = calls[0]?.args["request"] as { zip: string };
      expect(typeof request.zip).toBe("string");
      expect(request.zip).not.toContain(",");
      expect(sessions.refresh).toHaveBeenCalledTimes(1);
    } finally {
      await dispose();
    }
  });

  it("导出落到浏览器下载：拿到 zip 后触发一次 anchor 点击", async () => {
    const created: string[] = [];
    const downloaded: string[] = [];
    const target = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    target.createObjectURL = () => {
      const url = "blob:mock-" + String(created.length);
      created.push(url);
      return url;
    };
    target.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded.push(this.download);
    });
    const { face, calls, dispose } = await controllerWith(async () => ({
      ok: true,
      value: { filename: "s1.zip", zip: btoa("zip-bytes") },
    }));
    try {
      await face.exportZip("s1");
      expect(calls).toEqual([
        { endpoint: "sessionAdmin/export", args: { request: { sessionId: "s1" } } },
      ]);
      expect(created).toHaveLength(1);
      expect(downloaded).toEqual(["s1.zip"]);
    } finally {
      await dispose();
      delete target.createObjectURL;
      delete target.revokeObjectURL;
    }
  });

  it("整理数据回报四段结果并刷新列表", async () => {
    const sessions = { refresh: vi.fn(async () => undefined) };
    const { face, calls, dispose } = await controllerWith(
      async () => ({
        ok: true,
        value: {
          stoppedAgents: 2,
          orphanSessions: 3,
          orphanEvents: 12,
          rebuiltSessions: 5,
          vacuumed: true,
        },
      }),
      { sessions },
    );
    try {
      const result = await face.organizeData();
      expect(calls.map((call) => call.endpoint)).toEqual(["sessionAdmin/organize"]);
      expect(result).toMatchObject({ orphanSessions: 3, rebuiltSessions: 5, stoppedAgents: 2 });
      expect(sessions.refresh).toHaveBeenCalledTimes(1);
    } finally {
      await dispose();
    }
  });

  it("用量统计打 usage 并把范围带上", async () => {
    const totals = {
      turns: 2,
      steps: 2,
      userInputs: 2,
      toolCalls: 1,
      inputTokens: 100,
      outputTokens: 65,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      totalTokens: 165,
    };
    const { face, calls, dispose } = await controllerWith(async () => ({
      ok: true,
      value: { totals, subagent: totals, human: totals, buckets: [], sessions: [] },
    }));
    try {
      const report = await face.loadUsage("week");
      expect(calls).toEqual([
        { endpoint: "sessionAdmin/usage", args: { request: { range: "week" } } },
      ]);
      expect(report.totals.totalTokens).toBe(165);
    } finally {
      await dispose();
    }
  });

  it("用量统计响应不可用时给出失败原因", async () => {
    const { face, dispose } = await controllerWith(async () => ({
      ok: true,
      value: { totals: {} },
    }));
    try {
      await expect(face.loadUsage("all")).rejects.toThrow("用量统计响应不可用");
    } finally {
      await dispose();
    }
  });
});
