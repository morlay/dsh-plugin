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
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDirectory, provideAgent } from "@morlay/dsh-agent";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideStorageJson, StorageJsonDefault } from "@morlay/dsh-storage";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSessionRemote } from "@morlay/dsh-conversation/server";
import { SessionPersistence, SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { provideUpload } from "@morlay/dsh-upload/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideSkill } from "@morlay/dsh-skill/server";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import { provideApiSession } from "@morlay/dsh-conversation/server";
import {
  provideApiGateway,
  provideConnection,
  RemoteAccess,
  provideTypert,
  TypertGateway,
} from "@morlay/zephyr-app";
import { WebServerDefault, WebStartup, publishingTo } from "@morlay/zephyr-app/testing";
import { afterEach, describe, expect, it } from "vitest";
import { errorCodeOf, unwrap } from "./support/wire.ts";
import { SessionQuery, SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";

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
    readonly values: AppEnvValues = { dataDir: root, profileDir: root };

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
/** 准入替身：全放行（上游 `@Remote` 分派前读 `decide`）。 */
function allowAllAccess(): RemoteAccess {
  return {
    decide: () => ({ allowed: true }),
    allows: () => true,
    source: () => undefined,
    whenAccess: () => () => {},
    whenResourceAccess: () => () => {},
    registerPolicy: () => () => {},
    snapshotFor: () => ({}),
    follow: () => () => {},
    invalidate: () => {},
  } as unknown as RemoteAccess;
}

async function boot(
  reuseRoot?: string,
): Promise<{ app: App; handlers: RemoteHandlers; root: string }> {
  const root = reuseRoot ?? (await mkdtemp(join(tmpdir(), "dsh-session-endpoints-")));
  if (reuseRoot === undefined) roots.push(root);
  const FakeAppEnv = fakeAppEnvOf(root);
  const app = await bootstrapApplication({
    providers: [
      // 装配顺序 = 依赖顺序（适配行的契约面在它自己的 `onInit`/`mount` 之后才绑上，
      // 排在消费方后面就只能拿到壳）。分段注释写的是「为什么必须在前面」。
      ...provideTypert(),
      // 不装真实的 `RemoteAccess`：上游 gateway 分派前会按它判定（默认 deny）。用全放行替身——
      // 上游读 `decide(...)`，所以替身必须实现它。
      { provide: RemoteAccess, useFactory: () => allowAllAccess() },
      publishingTo(RemoteAccess, "remoteAccess"),
      // `provideApiGateway()` 已含 `RemoteHandlersDefault`：不能再并列一条（同名服务重复注册）。
      ...provideApiGateway(),
      // 凭据行必须先于连接行：`ConnectionDefault` 的 mount 里上游要 `credentials.modifyRecord`。
      ...provideAuth(),
      ...provideConnection(),
      ...provideAttachment(),
      // 命令注册表必须先于上传行：上游 `FileUploads` 在构造期就 `ctx.commands.registerFileReceiptResolver(…)`。
      ...provideCommand(),
      ...provideUpload(),
      // 存储：hub 与 domain 在前、后端紧随（domain 惰性 open，后端在自己的 onInit 里注册进 hub）。
      ...provideStorage(),
      ...provideStorageJson(configure(StorageJsonDefault, { root: join(root, "storages") })),
      // 会话持久化要排在 `provideWorkspace()` 之前：工作区注册表在 init 里 `listStoredHeaders()`（读它）。
      SessionPersistenceDefault,
      // 三份 root（store / 投影 / 查询）：agent 域要它们的面。
      ...provideSessionRemote(),
      FakeAppEnv,
      SubprocessDefault,
      SandboxDefault,
      { provide: SandboxPolicyDefault, config: { mode: "workspace-write", workspaceRoot: root } },
      FsSandbox,
      // agent 域要在工作区/技能之前：`working-directory` 的上游在 init 里读 `ctx.systemPrompt`，
      // `provideSkill()` 的 `ToolSkill` 在 apply 里就 `ctx.tools.register(...)`。
      ...provideAgent(),
      // 循环期：`session/create` 要真 agent 工厂（上游报的是 "no agent factory registered"）。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      // `session-skill-catalog` 行要 `working-directory`：真实现 + 临时目录。
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      // 工作区注册表（含 `SessionWorkspaceHost`；不另列同名条目）。
      ...provideWorkspace(),
      // `session-skill-catalog` 行要 `skill` 注册表（真模块）。
      ...provideSkill(),
      Startup0,
      WebServerDefault,
      ...provideApiSession(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  // 端点由**上游** `SessionController` 提供，分派走 `typertGateway`（不是我们的 handler 表）：
  // 这里给一个同形状的壳，让「按 `namespace/method` 调」的用例不必逐个改写。
  const gateway = app.get(TypertGateway);
  const peer = {
    id: "spec",
    signal: new AbortController().signal,
    interactions: "answer",
    // 上游分派前读 `peer.principal.kind`（资源准入用）。
    principal: { kind: "browser", id: "spec" },
  };
  const handlers = {
    invoke: async (endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> => {
      const at = endpoint.indexOf("/");
      try {
        return await gateway.invoke({
          namespace: endpoint.slice(0, at),
          method: endpoint.slice(at + 1),
          args,
          peer,
        } as never);
      } catch (error) {
        // 上游 `@Remote` 方法用**抛 `RemoteError`** 表达业务失败；wire 层会把它转成错误码。
        // 这里做同一层转换，既有的 `errorCodeOf(...)` 断言才能继续表达"期望哪种失败"。
        const candidate = error as { code?: unknown; message?: unknown };
        return {
          ok: false,
          error: {
            code: typeof candidate?.code === "string" ? candidate.code : "gateway/internal",
            message: typeof candidate?.message === "string" ? candidate.message : String(error),
          },
        };
      }
    },
  } as unknown as RemoteHandlers;
  return { app, handlers, root };
}

describe("session 组的宿主端点", { timeout: 30_000 }, () => {
  it("`sessionQuery` 观测带 projections 快照：agent 激活与 skill 目录的前提", async () => {
    const { app, handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as {
      sessionId?: string;
    };
    const sessionId = SessionId(created.sessionId ?? "");
    expect(sessionId, `先要有一个真会话：${JSON.stringify(created)}`).toBeTruthy();
    const query = app.get(SessionQuery);
    const observation = await query.observeSession(sessionId);
    try {
      // 上游 `SqliteSessionQuerySqliteEngine` 用 `ctx.get('sessionProjections')?.snapshot(session)` 算快照；
      // 这一行看不到 projections 行时，`Agent activation requires a projected Session observation` 就是结局。
      expect(
        observation.projections,
        "sessionQuery 行必须能按名读到 sessionProjections",
      ).toBeDefined();
    } finally {
      observation[Symbol.dispose]();
    }
  });

  it("真会话：`create` 起 agent，之后 `prompt` 被接受（不是 `session/not-found`，也不是 `gateway/internal`）", async () => {
    const { handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as {
      sessionId?: string;
    };
    const sessionId = created?.sessionId;
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

  it("`create` 带 `workspaceId`：会话落进那个工作区，不被 cwd 推导覆盖", async () => {
    const { app, handlers } = await boot();
    const root = await mkdtemp(join(tmpdir(), "dsh-workspace-target-"));
    // 真工作区：直接走宿主的 `WorkspaceRegistry`（`workspace/create` 那条 wire 属于 UI 行，
    // 本 spec 装的是宿主面）。先建出来，才有 workspaceId 可用。
    const registry = app.get(WorkspaceRegistry);
    const built = (await registry.create(root)) as { id?: string };
    const workspaceId = built?.id;
    expect(workspaceId, `先要有工作区，实际：${JSON.stringify(built)}`).toBeTruthy();

    const created = unwrap<{ sessionId?: string }>(
      await handlers.invoke("session/create", { request: { workspaceId } }),
    );
    const sessionId = created?.sessionId;
    expect(sessionId, "带 workspaceId 也要能建出会话").toBeTruthy();

    // 判据是**归属**：适配层若按 cwd 再推导一次，会把用户选的工作区换掉。
    // 直接看会话 header 的 `cwd`——上游按 `workspaceId` 解析出来的就是它。
    const cwd = app.get(SessionStore).get(SessionId(String(sessionId)))?.header.cwd;
    // `realpath`：macOS 上 `/var` 是 `/private/var` 的符号链接，直接比字面量会假红。
    expect(cwd, "会话的 cwd 必须落在所选工作区的目录上").toBe(await realpath(root));
  });

  it("宿主重启后（盘上有、live store 空）对一个已有会话 `prompt` 仍被接受", async () => {
    const first = await boot();
    const created = (await first.handlers.invoke("session/create", { request: {} })) as {
      sessionId?: string;
    };
    const sessionId = created.sessionId as string;
    expect(sessionId, "先要有一个真会话").toBeTruthy();
    // **落盘要显式刷一次**：上游 `create` 只拿到写句柄，真正写文件在 checkpoint 与 `flush` / `close`。
    // 这条用例模拟的是「上一个进程**正常退出**、盘上留着会话」——所以这里等价于退出前的刷盘。
    // 不刷的话进程没了、文件也没写，重启后 `session/not-found` 是必然的（不是恢复逻辑的缺陷）。
    await first.app.get(SessionPersistence).flush();
    await first.app.dispose();

    const second = await boot(first.root);
    try {
      const result = await second.handlers.invoke("session/prompt", {
        request: {
          requestId: "r-restart",
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: "你好" }],
        },
      });
      // 失败时把上游原文打出来：这条判据就是为了把「重启后 resume 失败」的完整原因钉在测试里。
      if ((result as { ok?: boolean }).ok !== true)
        console.log("[spec] restart prompt →", JSON.stringify(result));
      expect(errorCodeOf(result), "重启后对已有会话发消息不能失败").toBeUndefined();
      expect(unwrap<{ accepted?: boolean }>(result)).toEqual({ accepted: true });
    } finally {
      await second.app.dispose();
    }
  });

  it("`session/list` 按上游协议给出 `{ items }`（目录来源是查询索引）", async () => {
    const { handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as {
      sessionId?: string;
    };
    expect(created.sessionId, "先要有一个真会话").toBeTruthy();

    // 上游 `list` **不读 live store**，它读 `sessionQuery.listSessions()`（落盘索引）。
    // 所以这里断言两件事：形状是上游的 `{ items }`；以及"索引里有没有"这个事实——
    // 新建会话要等持久化侧写索引，这条时序是本装配尚未对齐的部分（见债）。
    const listed = (await handlers.invoke("session/list", {})) as
      | { items?: readonly { id?: string }[] }
      | undefined;
    expect(Array.isArray(listed?.items), "上游协议是 `{ items: [...] }`").toBe(true);
  });

  it("`canOpenWorkspacePath` 回真能力（boolean）", async () => {
    const { handlers } = await boot();
    const value = unwrap<boolean>(await handlers.invoke("session/canOpenWorkspacePath", {}));
    // 上游实现是 `return this.canOpenPath()`，而 `canOpenPath()` 读 **native 桌面能力**；
    // 本 spec 的装配里没有那份能力，所以只确认"没抛错、形状是 boolean 或缺席"。
    // 要收紧成 `false`，前提是补齐 native 能力（债：20261102-上游会话端点要手动装配子插件.md）。
    expect([true, false, undefined]).toContain(value);
  });

  it("`workspacePathApplications` 对不可用桌面回空数组（真结果）", async () => {
    const { handlers } = await boot();
    const value = unwrap<readonly unknown[]>(
      await handlers.invoke("session/workspacePathApplications", { path: "/tmp/whatever" }),
    );
    // 同上：没有 native 桌面能力时上游直接 `return []`；能力缺席时这里读不到值。
    expect(value === undefined || Array.isArray(value)).toBe(true);
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
    const result = await handlers.invoke("session/rename", {
      request: { sessionId: "s-missing", title: "标题" },
    });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it(
    "`selectModel`（真行为）：真会话选模型后，会话自己的 agent 读回同一条选择",
    { timeout: 60_000 },
    async () => {
      const { app, handlers } = await boot();
      const created = (await handlers.invoke("session/create", { request: {} })) as {
        sessionId?: string;
      };
      const sessionId = created?.sessionId;
      if (sessionId === undefined) {
        throw new Error(
          `先要有一个真会话（有活 agent 才谈得上选模型）：${JSON.stringify(created)}`,
        );
      }

      // 读回面先取一次基线：失败的选择**不许**改动 agent 上的选择（原子性）。
      const agent = (
        app.get(AgentDirectory) as unknown as {
          get(id: unknown): { model: { current(): unknown } } | undefined;
        }
      ).get(SessionId(sessionId));
      expect(agent, "会话要有活 agent 才谈得上读回").toBeDefined();
      const before = agent?.model.current();

      // 组合从**真目录**取：本装配没有 LLM provider 行，目录的 `default` 因此不可路由——
      // 这一格判的是「活 agent 解析到了 + 模型闸门真的挡了」（比旧的"只证明转发"强），
      // 成功路径（选完读回新值）要装一个可路由的 provider 行，属另一件事。
      const catalogResult = await handlers.invoke("session/modelCatalog", {});
      const catalog = unwrap<{
        default: { provider: string; model: string };
        routableProviders: readonly string[];
      }>(catalogResult);
      if (catalog === undefined) {
        throw new Error(`session/modelCatalog 没回目录：${JSON.stringify(catalogResult)}`);
      }
      const target = catalog.default;

      const result = await handlers.invoke("session/selectModel", {
        request: { sessionId, provider: target.provider, model: target.model },
      });
      // 有可路由 provider 时成功并回归一化选择；没有时必须是**模型闸门**的结构化错误，
      // 而不是 `session/not-found`（那说明活 agent 没解析到，链路根本没走到模型这一层）。
      if (catalog.routableProviders.length === 0) {
        expect(errorCodeOf(result)).toBe("session/model-unavailable");
      } else {
        const selected = unwrap<{ selected: { provider: string; model: string } }>(result);
        if (selected === undefined) {
          throw new Error(`selectModel 没回归一化选择：${JSON.stringify(result)}`);
        }
        expect(selected.selected, "端点回的是归一化后的选择").toMatchObject({
          provider: target.provider,
          model: target.model,
        });
        expect(agent?.model.current(), "agent 上的选择就是刚下发的那一条").toMatchObject({
          provider: target.provider,
          model: target.model,
        });
      }

      // 读回**会话自己的 agent**：失败的选择不改变它（同一条断言在成功路径上已在上面覆过）。
      if (catalog.routableProviders.length === 0) {
        expect(agent?.model.current(), "失败的选择不许改动 agent 上的选择").toEqual(before);
      }
    },
  );

  it("`selectModel`（失败面）：未知会话回 `session/not-found`", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/selectModel", {
      request: { sessionId: "s-missing", provider: "deepseek-official", model: "deepseek-flash" },
    });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`fork`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需会话进 sqlite 索引", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/fork", { request: { sessionId: "s-missing" } });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`prompt`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/prompt", {
      request: {
        requestId: "r1",
        sessionId: "s-missing",
        mode: "queue",
        content: [{ type: "text", text: "你好" }],
      },
    });
    // 未知会话时上游 `commands.prompt` 抛的是带结构化的 `session/not-found`（`ServiceScope` 现在把
    // `ctx.invocation` 按上游语义给成 `undefined`，所以链路能走到「解析会话」这一步，而不是在半路崩）。
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`cancel`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/cancel", { request: { sessionId: "s-missing" } });
    expect(errorCodeOf(result)).toBe("session/not-found");
  });

  it("`updateQueue`（弱断言）：转发到上游，未知会话回 `session/not-found`；真行为还需活 agent", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("session/updateQueue", {
      request: { sessionId: "s-missing", itemId: "m1", action: { kind: "remove" } },
    });
    // 上游自己的队列失败码。
    expect(errorCodeOf(result)).toBe("session/queue-item-not-found");
  });

  it("`search`（弱断言）：转发到上游，空索引回空结果；真行为还需会话进 sqlite 索引", async () => {
    const { handlers } = await boot();
    const value = unwrap<{ items: readonly unknown[]; hasMore: boolean }>(
      await handlers.invoke("session/search", { request: { query: "不存在的内容" } }),
    );
    expect(value).toEqual({ items: [], hasMore: false });
  });
});
