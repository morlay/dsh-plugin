// `SessionControllerHost` 的接缝：它在 `onInit` 里注册哪些 endpoint、`create` 的返回与事件载荷长什么样。
//
// 这里不需要 WebSocket，也不需要传输层——`RemoteHandlers` 就是宿主侧**唯一**的消费面，
// 直接调它等于「mock client 打了一次真实的服务」。会话持久化用真实现（落临时目录），
// 目标目录与挂载动作是 `SessionWorkspace` 契约的替身（它由 workspace 那一侧提供）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentLoop } from "@morlay/dsh-agent";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { SessionWorkspace } from "../contract/session-workspace.contract.ts";
import { SessionStore } from "../contract/session.contract.ts";
import { SessionControllerHost } from "../server/session-controller.host.ts";
import { provideSessionProjection } from "../server/session-projection.provide.ts";
import { SessionProjectionStore } from "../contract/session-projection-store.contract.ts";
import { RemoteSessionHost } from "../server/session-controller.row.ts";
import { SessionEndpointDefault } from "../server/session-endpoint.service.ts";
import { provideSessionsHost } from "../server/sessions-host.provide.ts";
import { FakeAppEnv } from "./support/fake-app-env.ts";

const apps: { dispose(): Promise<void> }[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 10_000);

/** 目标目录的解析与「会话挂到 workspace」：测试里记录调用即可。 */
@Injectable()
class FakeSessionWorkspace extends SessionWorkspace {
  readonly resolved: { workspaceId?: string; cwd?: string }[] = [];

  readonly attached: { sessionId: string; workspaceId?: string }[] = [];

  async resolve(
    request: Parameters<SessionWorkspace["resolve"]>[0],
  ): ReturnType<SessionWorkspace["resolve"]> {
    this.resolved.push(request);
    if (request.workspaceId === "w-missing") throw new Error('workspace "w-missing" not found');
    const workspaceId = request.workspaceId;
    return {
      cwd: workspaceId === undefined ? (request.cwd ?? "/tmp/default") : `/tmp/${workspaceId}`,
      attach: async (sessionId: string): Promise<void> => {
        this.attached.push({ sessionId, ...(workspaceId === undefined ? {} : { workspaceId }) });
      },
    };
  }
}

/**
 * 上游 `SessionController` 的占位：目录端点（list/create/page/follow）不碰它，
 * 只有 `rename` 这类会话语义端点才需要真实例（那些用例在 `session-endpoints.spec.ts`）。
 */
@Injectable()
class FakeRemoteSessionHost extends RemoteSessionHost {
  readonly typertRemote = { namespace: "session", methods: [] };
}

/**
 * 上游 `AgentLoop` 的假件：这条装配**没有** `AgentDefaultModel`，`session/create` 应该在调到这里之前
 * 就报错；`create` 仍记录调用，用来证明它没被调用（空 selection 建 agent 的那条旧路）。
 */
@Injectable()
class FakeAgentLoop extends AgentLoop {
  readonly created: string[] = [];

  readonly config: AgentLoop["config"] = { maxParallelToolCalls: { get: () => 1 }, agents: [] };

  readonly create: AgentLoop["create"] = async (id) => {
    this.created.push(String(id));
    throw new Error("FakeAgentLoop.create 不该被调用（缺 agentDefaultModel 时应在调用前报错）");
  };

  readonly createAgent: AgentLoop["createAgent"] = async () => {
    throw new Error("FakeAgentLoop.createAgent 不该被调用");
  };

  readonly resume: AgentLoop["resume"] = async () => {
    throw new Error("FakeAgentLoop.resume 不该被调用");
  };
}

/**
 * 起一个只装「路由表 + 会话服务 + 目标目录接缝 + 会话端点行」的最小栈（持久化真落临时目录）。
 * @param options - `withAgentLoop` 决定是否装 agent 行；`dataDir` 复用上一次的盘（模拟宿主重启）。
 */
async function boot(options: { withAgentLoop?: boolean; dataDir?: string; withProjections?: boolean } = {}): Promise<{
  app: App;
  handlers: RemoteHandlers;
  workspace: FakeSessionWorkspace;
  persistence: SessionPersistenceDefault;
}> {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "dsh-sessions-host-")));
  if (options.dataDir === undefined) roots.push(dataDir);
  FakeAppEnv.root = dataDir;
  const app = await bootstrapApplication({
    providers: [
      FakeAppEnv,
      SessionPersistenceDefault,
      FakeSessionWorkspace,
      RemoteHandlersDefault,
      FakeRemoteSessionHost,
      ...(options.withAgentLoop === true ? [FakeAgentLoop] : []),
      SessionEndpointDefault,
      ...provideSessionsHost(),
      ...(options.withProjections === true ? provideSessionProjection() : []),
    ],
    timeoutMs: 5_000,
  });
  apps.push(app);
  return {
    app,
    handlers: app.get(RemoteHandlers),
    workspace: app.get(FakeSessionWorkspace),
    persistence: app.get(SessionPersistenceDefault),
  };
}

describe("SessionControllerHost 的 Remote 面", { timeout: 10_000 }, () => {
  it("onInit 注册了 session/list 与 session/create", async () => {
    const { handlers } = await boot();
    // 未注册的 endpoint 会抛「没有实现」；这两个不抛就说明注册过。
    await expect(handlers.invoke("session/list", { _request: {} })).resolves.toEqual({
      ids: [],
      byId: {},
    });
    await expect(handlers.invoke("session/create", { request: {} })).resolves.toEqual({
      sessionId: "session-1",
    });
  });

  it("create 的返回值与事件载荷对齐上游 `SessionSummary`（id/cwd/blank/retainedBy）", async () => {
    const { handlers } = await boot();
    const published: unknown[] = [];
    handlers.subscribe("api-session/added", (summary) => published.push(summary));

    await handlers.invoke("session/create", { request: { cwd: "/tmp/demo" } });

    const summary = published[0] as {
      id?: string;
      sessionId?: string;
      cwd?: string;
      blank?: boolean;
      running?: boolean;
      updatedAt?: number;
      retainedBy?: unknown;
    };
    expect(summary.id).toBe("session-1");
    expect(summary.sessionId).toBe("session-1");
    expect(summary.cwd).toBe("/tmp/demo");
    expect(summary.blank).toBe(true);
    expect(summary.running).toBe(false);
    expect(typeof summary.updatedAt).toBe("number");
    // `retainedBy` 必须是对象：`?? 0` 只护住 `mainView` 的值，不护住 `retainedBy` 本身。
    expect(summary.retainedBy).toEqual({});
  });

  it("给定 workspaceId 时按 workspace 的目录建会话，并把它挂到该 workspace 上", async () => {
    const { handlers, workspace, persistence } = await boot();
    const created = (await handlers.invoke("session/create", {
      request: { workspaceId: "w1" },
    })) as { sessionId?: string };

    expect(created.sessionId).toBe("session-1");
    expect(workspace.resolved).toEqual([{ workspaceId: "w1" }]);
    expect(workspace.attached).toEqual([{ sessionId: "session-1", workspaceId: "w1" }]);
    // 挂载前必须有 header：workspace 的 `attachSession` 会按它校验 cwd。
    const stored = await persistence.stat(SessionId("session-1"));
    expect(stored?.header).toMatchObject({ id: "session-1", cwd: "/tmp/w1" });
  });

  it("workspace 不存在时报错，且不建会话", async () => {
    const { handlers } = await boot();
    await expect(
      handlers.invoke("session/create", { request: { workspaceId: "w-missing" } }),
    ).rejects.toThrow('workspace "w-missing" not found');
    const listed = (await handlers.invoke("session/list", { _request: {} })) as {
      ids: readonly string[];
    };
    expect(listed.ids).toEqual([]);
  });

  it("只有 seed 类事件的会话仍是空白会话（blank 只看有没有 turn）", async () => {
    const { app, handlers } = await boot();
    await handlers.invoke("session/create", { request: { workspaceId: "w1" } });
    // agent 建立会话时会写 `session/end-seed`：它有 `seq` 但不是对话内容，不能把会话变成「非空白」。
    app.get(SessionStore).get(SessionId("session-1"))?.append("session/end-seed", {});

    const listed = (await handlers.invoke("session/list", { _request: {} })) as {
      byId: Record<string, { blank?: boolean }>;
    };
    expect(listed.byId["session-1"]?.blank, "seed 事件不结束空白状态").toBe(true);
  });

  it("目录行的 blank 跟随会话事件数：空白会话 true，写入事件后 false", async () => {
    const { app, handlers } = await boot();
    await handlers.invoke("session/create", { request: { workspaceId: "w1" } });

    // 新会话（`seq === 0`）在 wire 上是 blank：上游 `ui-conversation` 靠这一位决定 hero / 底部输入栏。
    const blankRow = (await handlers.invoke("session/list", { _request: {} })) as {
      byId: Record<string, { blank?: boolean }>;
    };
    expect(blankRow.byId["session-1"]?.blank).toBe(true);

    // 会话里有事件（`seq > 0`，即「不是空白会话」）→ 行上 blank 必须翻成 false。
    const session = app.get(SessionStore).get(SessionId("session-1"));
    expect(session).toBeDefined();
    session?.append("turn/start", { turn: 1 });

    const engagedRow = (await handlers.invoke("session/list", { _request: {} })) as {
      byId: Record<string, { blank?: boolean }>;
    };
    expect(engagedRow.byId["session-1"]?.blank).toBe(false);
  });

  it("list 把已建的会话列出来，行里带 cwd 与 retainedBy", async () => {
    const { handlers } = await boot();
    await handlers.invoke("session/create", { request: { workspaceId: "w1" } });

    const listed = (await handlers.invoke("session/list", { _request: {} })) as {
      ids: readonly string[];
      byId: Record<string, { cwd?: string; retainedBy?: unknown }>;
    };
    expect(listed.ids).toEqual(["session-1"]);
    expect(listed.byId["session-1"]?.cwd).toBe("/tmp/w1");
    expect(listed.byId["session-1"]?.retainedBy).toEqual({});
  });
});

describe("session/page：未知会话不静默回空页", () => {
  it("不存在的 sessionId 直接 reject", async () => {
    const { handlers } = await boot();
    await expect(
      handlers.invoke("session/page", { request: { sessionId: "session-missing" } }),
    ).rejects.toThrow(/no such session/);
  });

  it("存在的会话回空页（历史窗口未实现是已知缺口）", async () => {
    const { handlers } = await boot();
    await handlers.invoke("session/create", { request: { cwd: "/tmp/paged" } });
    await expect(
      handlers.invoke("session/page", { request: { sessionId: "session-1" } }),
    ).resolves.toEqual({ records: [], hasMore: false });
  });
});

describe("装了 agent 行但缺默认模型", () => {
  it("`session/create` 在调 `AgentLoop.create` 之前就报错", { timeout: 10_000 }, async () => {
    const { app, handlers } = await boot({ withAgentLoop: true });
    await expect(
      handlers.invoke("session/create", { request: { cwd: "/tmp/no-model" } }),
    ).rejects.toThrow(/agentDefaultModel/);
    // 空 selection 建 agent 的旧路：假件的 `create` 一次都没被调到。
    expect((app.get(AgentLoop) as FakeAgentLoop).created).toEqual([]);
  });
});

describe("session/follow：首帧带上投影值", () => {
  it("首帧的 projections.values 含 `modelSelection`（否则客户端模型选择器永远 loading）", { timeout: 10_000 }, async () => {
    const { app, handlers } = await boot({ withProjections: true });
    // 注册一个 wire 可见的投影：形状与上游 `modelSelection` 的 view 一致（`{ lastUsed, next }`）。
    const registry = app.get(SessionProjectionStore);
    const passThrough = { parse: (value: unknown): unknown => value };
    await registry.register({
      key: "modelSelection",
      stateVersion: 1,
      stateSchema: passThrough,
      init: () => ({ lastUsed: null, next: { provider: "deepseek-official", model: "deepseek-flash" } }),
      apply: (state: unknown) => state,
      wire: { viewSchema: passThrough, view: (state: unknown) => state },
    } as never);

    await handlers.invoke("session/create", { request: { cwd: "/tmp/projected" } });
    const host = app.get(SessionControllerHost);
    const controller = new AbortController();
    const frames = host.follow({ address: { sessionId: "session-1" } }, controller.signal);
    const first = await frames.next();
    controller.abort();

    const snapshot = first.value as {
      type?: string;
      projections?: { values?: Record<string, unknown> };
    };
    expect(snapshot.type).toBe("snapshot");
    // 键必须在：客户端 `faceOf('modelSelection')` 读的就是它。
    expect(snapshot.projections?.values, "首帧的 projections.values 不能是空对象").toHaveProperty(
      "modelSelection",
    );
  });
});

describe("宿主重启后的目录（live store ∪ 持久化盘）", () => {
  it("同一个 dataDir 重启后 `session/list` 仍列出盘上的会话，blank 按盘上事件数", { timeout: 10_000 }, async () => {
    const first = await boot();
    // 两条会话都只有 header：`session-1` 留白，`session-2` 随后落一条事件（有历史的会话）。
    await first.handlers.invoke("session/create", { request: { cwd: "/tmp/blank" } });
    await first.handlers.invoke("session/create", { request: { cwd: "/tmp/engaged" } });
    const handle = await first.persistence.open(SessionId("session-2"), "write");
    await handle.append([{ type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } as never]);
    await handle.close();
    // 第三条：盘上只有 seed 事件（agent 建会话时写的那种），仍然是空白会话。
    await first.handlers.invoke("session/create", { request: { cwd: "/tmp/seeded" } });
    const seeded = await first.persistence.open(SessionId("session-3"), "write");
    await seeded.append([{ type: "session/end-seed", seq: 0, time: 1, data: {} } as never]);
    await seeded.close();

    // 重启：新 app、同一个 dataDir（live store 一定是空的）。
    const dataDir = FakeAppEnv.root;
    await first.app.dispose();
    const second = await boot({ dataDir });

    const listed = (await second.handlers.invoke("session/list", { _request: {} })) as {
      ids: readonly string[];
      byId: Record<string, { blank?: boolean; cwd?: string }>;
    };
    // 目录来自盘：两条都要在，且空白会话的 `blank` 必须由「盘上有没有事件」决定。
    expect(listed.ids).toEqual(expect.arrayContaining(["session-1", "session-2", "session-3"]));
    expect(listed.byId["session-1"]?.blank, "只有 header 的会话是空白会话").toBe(true);
    expect(listed.byId["session-1"]?.cwd).toBe("/tmp/blank");
    expect(listed.byId["session-2"]?.blank, "盘上有 turn 的会话不再是空白会话").toBe(false);
    expect(listed.byId["session-3"]?.blank, "盘上只有 seed 事件的会话仍是空白会话").toBe(true);
  });
});

describe("真宿主：会话不是占位对象", () => {
  it("`session/create` 建出的是真 `Session`，`get` 拿回同一个实例（`toBe`）", { timeout: 10_000 }, async () => {
    const { app, handlers } = await boot();
    await handlers.invoke("session/create", { request: { cwd: "/tmp/real" } });

    const host = app.get(SessionControllerHost);
    const session = host.get("session-1");
    expect(session).toBeDefined();
    // 同一个实例：宿主再取一次、store 直接取一次，都必须是这一份（不是复制出来的 `{header:{cwd}}`）。
    expect(host.get("session-1")).toBe(session);
    expect(app.get(SessionStore).get(SessionId("session-1"))).toBe(session);
    // 上游 21 个端点要的真成员：事件读写与序列。
    expect(typeof session?.eventAt).toBe("function");
    expect(typeof session?.append).toBe("function");
    expect(session?.seq).toBe(0);
  });

  it("没有的会话 `get` 返回 `undefined`（不造占位对象）", { timeout: 10_000 }, async () => {
    const { app } = await boot();
    expect(app.get(SessionControllerHost).get("session-missing")).toBeUndefined();
  });
});

describe("列表行的投影摘要", () => {
  it("`snapshotForRemote()` 的行带上真会话的 `agentPreset`（上游 `restoreBlank` 读它）", { timeout: 10_000 }, async () => {
    const { app } = await boot();
    const sessions = app.get(SessionStore);
    const session = sessions.prepare(SessionId("s-proj"), { meta: { agentPreset: "cordis" } });
    sessions.enter(session);
    sessions.announce(session);

    const listed = await app.get(SessionControllerHost).snapshotForRemote();
    expect(listed.byId["s-proj"]).toMatchObject({
      projections: { kind: "sequenced", values: { agentPreset: "cordis" } },
    });
  });
});

describe("create 的幂等语义", () => {
  it("带已存在的 `sessionId` 时返回同一个会话（不抛 already exists）", { timeout: 10_000 }, async () => {
    const { handlers } = await boot();
    const first = await handlers.invoke("session/create", {
      request: { workspaceId: "w1", sessionId: "session-9" },
    });
    expect(first).toEqual({ sessionId: "session-9" });

    // 第二次：live store 里已有它 → 直接返回，并确保仍挂在 workspace 上（`restoreBlank` 每次 reload 都走这条）。
    const second = await handlers.invoke("session/create", {
      request: { workspaceId: "w1", sessionId: "session-9" },
    });
    expect(second).toEqual({ sessionId: "session-9" });
  });

  it("请求的 `sessionId` 已有内容时不复用：新建一条空白会话", { timeout: 10_000 }, async () => {
    const { app, handlers } = await boot();
    await handlers.invoke("session/create", { request: { cwd: "/tmp/engaged" } });
    // 这条会话已经发过消息（`seq > 0`）：它不再是「可复用的 blank」，点「新建会话」必须新建。
    app.get(SessionStore).get(SessionId("session-1"))?.append("turn/start", { turn: 1 });

    const created = (await handlers.invoke("session/create", {
      request: { cwd: "/tmp/engaged", sessionId: "session-1" },
    })) as { sessionId?: string };
    expect(created.sessionId, "有内容的会话不能被 `session/create` 原样复用").not.toBe("session-1");
    expect(created.sessionId).toBe("session-2");
  });

  it("请求的 `sessionId` 只有 seed 事件时仍复用（agent 建出来的空白会话）", { timeout: 10_000 }, async () => {
    const { app, handlers } = await boot();
    await handlers.invoke("session/create", { request: { cwd: "/tmp/seeded" } });
    app.get(SessionStore).get(SessionId("session-1"))?.append("session/end-seed", {});

    const created = (await handlers.invoke("session/create", {
      request: { cwd: "/tmp/seeded", sessionId: "session-1" },
    })) as { sessionId?: string };
    expect(created.sessionId, "seed 事件不结束空白状态，仍应复用").toBe("session-1");
  });

  it("盘上的会话已有事件时也不复用（重启后点新建仍新建）", { timeout: 10_000 }, async () => {
    const first = await boot();
    await first.handlers.invoke("session/create", { request: { cwd: "/tmp/engaged" } });
    // 落盘一条事件：这条会话在盘上也不再是空白会话。
    const handle = await first.persistence.open(SessionId("session-1"), "write");
    await handle.append([{ type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } as never]);
    await handle.close();
    const dataDir = FakeAppEnv.root;
    await first.app.dispose();

    const second = await boot({ dataDir });
    const created = (await second.handlers.invoke("session/create", {
      request: { cwd: "/tmp/engaged", sessionId: "session-1" },
    })) as { sessionId?: string };
    expect(created.sessionId, "盘上有事件的会话不能被复用").not.toBe("session-1");
  });

  it("不带 id 新建时按**已落盘**的 id 集合避让（reload 后不会撞 session-1）", { timeout: 10_000 }, async () => {
    const { handlers } = await boot();
    await handlers.invoke("session/create", { request: { cwd: "/tmp/a" } });
    await handlers.invoke("session/create", { request: { cwd: "/tmp/b" } });
    expect(await handlers.invoke("session/create", { request: { cwd: "/tmp/c" } })).toEqual({
      sessionId: "session-3",
    });
  });
});
