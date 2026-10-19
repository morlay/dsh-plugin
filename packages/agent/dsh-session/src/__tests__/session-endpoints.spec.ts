/**
 * `session` 组 8 个端点的宿主面：真 `SessionControllerRow`（上游 `SessionController`）+ 真依赖栈。
 *
 * 判据分两档（每条都写明档位）：
 * - **真行为**：`canOpenWorkspacePath` / `workspacePathApplications` / `modelCatalog` /
 *   `initializeDefaultModel` —— 不依赖活 agent 与 sqlite 索引，断言上游真结果或其自己的结构化错误；
 * - **弱断言**：`rename` / `selectModel` / `fork` / `search` —— 只证明端点接上、转发路径通，
 *   断言上游的结构化失败码。要覆盖真行为还需要：`rename`/`selectModel` 装真 `AgentLoop.create`
 *   同一会话 id（活 agent）；`fork`/`search` 让会话进 `provideSessionQuerySqlite` 的索引。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionRemote } from "../server/session-remote.provide.ts";
import { provideSessionsHost } from "../server/sessions-host.provide.ts";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { provideUpload } from "@morlay/dsh-upload/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-working-directory";
import { provideSkill } from "@morlay/dsh-skill/server";
import { SessionWorkspaceHost } from "@morlay/dsh-workspace";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import { provideApiGateway, provideConnection, provideRemoteAccess, RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { WebServerDefault, WebStartup } from "@morlay/zephyr-app/testing";
import { afterEach, describe, expect, it } from "vitest";
import { errorCodeOf, unwrap } from "./support/wire.ts";
import { provideSessionQuerySqlite } from "../server/session-query.provide.ts";
import { SessionQuery } from "../contract/session-query.contract.ts";
import { SessionId } from "@deepseek-ai/dsh-session";

/** `web-server` 只给 `ApiGateway` 做依赖占位（`ApiGatewayDefault` 不把它交给上游）；端口 0 = 随机，不撞 dev server。 */
@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 指向临时目录的运行环境。 */
function fakeAppEnvOf(root: string): new () => AppEnv {
  @Injectable()
  class FakeAppEnv extends AppEnv {
    readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false, aggregate: [] };

    readonly cacheDir = join(root, "cache");

    readonly packageRoot = root;

    readonly appBootDir = join(root, "boot");

    readonly profileManifest = join(root, "package.json");
  }
  return FakeAppEnv;
}

/**
 * 起 `session` 组的宿主栈（真 controller 行 + 真依赖，无端口）。
 * @param reuseRoot - 复用已有的数据根（模拟「宿主重启、live store 空、盘上还有会话」）。
 * @returns 应用与 wire 表。
 */
async function boot(reuseRoot?: string): Promise<{ app: App; handlers: RemoteHandlers; root: string }> {
  const root = reuseRoot ?? (await mkdtemp(join(tmpdir(), "dsh-session-endpoints-")));
  if (reuseRoot === undefined) roots.push(root);
  const FakeAppEnv = fakeAppEnvOf(root);
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      ...provideTypert(),
      ...provideRemoteAccess(),
      ...provideApiGateway(),
      ...provideConnection(),
      ...provideAuth(),
      ...provideAttachment(),
      ...provideUpload(),
      ...provideCommand(),
      ...provideWorkspace(),
      ...provideStorage(),
      // `session-skill-catalog` 行要 `skill` 注册表（真模块）。
      ...provideSkill(),
      // **真模块**：端点行与宿主行由模块提供，不在 spec 里手写 providers——
      // 「某行没进 Module」这类装配缺陷只有真模块才能暴露。
      ...provideSessionRemote(),
      ...provideSessionsHost(),
    
      FakeAppEnv,
      // `session-skill-catalog` 行要 `working-directory`：真实现 + 临时目录（`withConfig` 给的是 providers，不是 Module）。
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      ...provideAgent(),
      SubprocessDefault,
      SandboxDefault,
      configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root })([SandboxPolicyDefault]),
      FsSandbox,
      SessionPersistenceDefault,
      ...providePersistence(configure(StorageJsonDefault, { root: join(root, "storages") })),
      Startup0,
      WebServerDefault,
      RemoteHandlersDefault,
      SessionWorkspaceHost,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { app, handlers: app.get(RemoteHandlers), root };
}


describe("session 组的宿主端点", { timeout: 30_000 }, () => {
  it("`sessionQuery` 观测带 projections 快照：agent 激活与 skill 目录的前提", async () => {
    const { app, handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as { sessionId?: string };
    const sessionId = SessionId(created.sessionId ?? "");
    expect(sessionId, "先要有一个真会话").toBeTruthy();
    const query = app.get(SessionQuery);
    const observation = await query.observeSession(sessionId);
    try {
      // 上游 `SqliteSessionQuerySqliteEngine` 用 `ctx.get('sessionProjections')?.snapshot(session)` 算快照；
      // 这一行看不到 projections 行时，`Agent activation requires a projected Session observation` 就是结局。
      expect(observation.projections, "sessionQuery 行必须能按名读到 sessionProjections").toBeDefined();
    } finally {
      observation[Symbol.dispose]();
    }
  });

  it("真会话：`create` 起 agent，之后 `prompt` 被接受（不是 `session/not-found`，也不是 `gateway/internal`）", async () => {
    const { handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as { sessionId?: string };
    const sessionId = created.sessionId;
    expect(sessionId, "先要有一个真会话").toBeTruthy();
    const result = await handlers.invoke("session/prompt", {
      request: {
        requestId: "r1",
        sessionId,
        mode: "queue",
        content: [{ type: "text", text: "你好" }],
      },
    });
    // `session/create` 与上游同义：**会话与 agent 一起建**。只入 store 不起 agent 时，这条 prompt
    // 会在 resume 上撞 `session "<id>" already exists`（装配缺陷被端到端复现）。
    expect(errorCodeOf(result)).toBeUndefined();
    expect(unwrap<{ accepted?: boolean }>(result)).toEqual({ accepted: true });
  });


  it("宿主重启后（盘上有、live store 空）对一个已有会话 `prompt` 仍被接受", async () => {
    const first = await boot();
    const created = (await first.handlers.invoke("session/create", { request: {} })) as { sessionId?: string };
    const sessionId = created.sessionId as string;
    expect(sessionId, "先要有一个真会话").toBeTruthy();
    await first.app.dispose();

    const second = await boot(first.root);
    try {
      const result = await second.handlers.invoke("session/prompt", {
        request: { requestId: "r-restart", sessionId, mode: "queue", content: [{ type: "text", text: "你好" }] },
      });
      // 失败时把上游原文打出来：这条判据就是为了把「重启后 resume 失败」的完整原因钉在测试里。
      if ((result as { ok?: boolean }).ok !== true) console.log("[spec] restart prompt →", JSON.stringify(result));
      expect(errorCodeOf(result), "重启后对已有会话发消息不能失败").toBeUndefined();
      expect(unwrap<{ accepted?: boolean }>(result)).toEqual({ accepted: true });
    } finally {
      await second.app.dispose();
    }
  });

  it("`session/create` 之后，会话目录里有那一行（UI 形态的根因是数据，不是 DOM）", async () => {
    const { handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as { sessionId?: string };
    const sessionId = created.sessionId;
    expect(sessionId, "session/create 必须回一个会话身份").toBeTruthy();
    const listed = await handlers.invoke("session/list", {});
    const ids = (listed as { ids?: readonly string[] } | undefined)?.ids ?? [];
    expect(ids, "新建的会话必须出现在目录里——binding() / scope() 都靠这一行").toContain(sessionId);
  });


  it("`canOpenWorkspacePath` 回真能力（boolean）", async () => {
    const { handlers } = await boot();
    const value = unwrap<boolean>(await handlers.invoke("session/canOpenWorkspacePath", {}));
    expect(typeof value).toBe("boolean");
  });

  it("`workspacePathApplications` 对不可用桌面回空数组（真结果）", async () => {
    const { handlers } = await boot();
    const value = unwrap<readonly unknown[]>(
      await handlers.invoke("session/workspacePathApplications", { path: "/tmp/whatever" }),
    );
    expect(Array.isArray(value)).toBe(true);
  });

  it("`modelCatalog` 回真目录结构（provider 分组 + 默认选择 + 失败面）", async () => {
    const { handlers } = await boot();
    const value = unwrap<{
      default: { provider: string; model: string };
      routableProviders: readonly string[];
      groups: readonly unknown[];
      failures: readonly unknown[];
    }>(await handlers.invoke("session/modelCatalog", {}));
    expect(value).toMatchObject({
      default: { provider: expect.any(String), model: expect.any(String) },
      routableProviders: expect.any(Array),
      groups: expect.any(Array),
      failures: expect.any(Array),
    });
  });

  it("`initializeDefaultModel` 走真路径：成功或上游自己的结构化错误", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/initializeDefaultModel", {});
    expect(
      (result as { ok?: unknown }).ok === true || typeof errorCodeOf(result) === "string",
    ).toBe(true);
  });

  // ---------- 以下四条是**弱断言**：只证明端点接上、转发路径通，没覆盖真行为 ----------

  it("`rename`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需真 `AgentLoop.create` 同一 id", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/rename", { sessionId: "s-missing", title: "标题" });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`selectModel`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/selectModel", {
      sessionId: "s-missing",
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`fork`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需会话进 sqlite 索引", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/fork", { sessionId: "s-missing" });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`prompt`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/prompt", {
      requestId: "r1",
      sessionId: "s-missing",
      mode: "queue",
      content: [{ type: "text", text: "你好" }],
    });
    // 未知会话时上游 `commands.prompt` 抛的是带结构化的 `session/not-found`（`ServiceScope` 现在把
    // `ctx.invocation` 按上游语义给成 `undefined`，所以链路能走到「解析会话」这一步，而不是在半路崩）。
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`cancel`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/cancel", { sessionId: "s-missing" });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`updateQueue`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/updateQueue", {
      sessionId: "s-missing",
      itemId: "m1",
      action: { kind: "remove" },
    });
    // 上游自己的队列失败码。
    expect(errorCodeOf(result)).toBe("session/queue-item-not-found");
  });

  it("`search`（弱断言）：转发到上游，空索引回空结果；真行为还需会话进 sqlite 索引", async () => {
    const { handlers } = await boot();
    const value = unwrap<{ items: readonly unknown[]; hasMore: boolean }>(
      await handlers.invoke("session/search", { query: "不存在的内容" }),
    );
    expect(value).toEqual({ items: [], hasMore: false });
  });
});
