/**
 * `@` 引用的两条候选端点（`fileReferences/list` 与 `sessionReferenceResolver/candidates`）：
 * 真模块栈 + 真 `RemoteHandlers.invoke`，不手写端点替身。
 *
 * 判据是「候选非空且指向真实路径」——静默返回空数组不算接上：
 * 输入框里的 `@` 菜单拿空列表和拿「没有实现」在用户眼里都是「没生效」。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideApiSession, provideSessionReference } from "@morlay/dsh-conversation/server";
import { gatewayHandlers } from "./support/gateway-handlers.ts";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideStorageJson, StorageJsonDefault } from "@morlay/dsh-storage";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSkill } from "@morlay/dsh-skill/server";
import { SessionPersistence, SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { provideUpload } from "@morlay/dsh-upload/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import {
  provideApiGateway,
  provideConnection,
  RemoteAccess,
  provideTypert,
} from "@morlay/zephyr-app";
import { WebServerDefault, WebStartup, publishingTo } from "@morlay/zephyr-app/testing";
import { afterEach, describe, expect, it } from "vitest";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionQuery } from "@morlay/dsh-session";
import { SessionStore } from "@morlay/dsh-session";
import { provideSessionRemote } from "@morlay/dsh-conversation/server";
import { errorCodeOf, unwrap } from "./support/wire.ts";

/** `web-server` 只给 `ApiGateway` 做依赖占位；端口 0 = 随机，不撞 dev server。 */
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
 * 起会话宿主栈（真模块；`provideSessionReference` 提供 `sessionReferenceResolver` 那一行）。
 * @param existingRoot - 传同一个 dataDir 起第二次（模拟宿主重启）；省略时新建临时目录。
 * @returns 应用、wire 表与 dataDir。
 */
async function boot(
  existingRoot?: string,
): Promise<{ app: App; handlers: RemoteHandlers; root: string }> {
  const root = existingRoot ?? (await mkdtemp(join(tmpdir(), "dsh-session-references-")));
  roots.push(root);
  const FakeAppEnv = fakeAppEnvOf(root);
  const app = await bootstrapApplication({
    providers: [
      // 装配顺序 = 依赖顺序（适配行的契约面在它自己的 mount 之后才绑上）。
      ...provideTypert(),
      // 上游 gateway 分派前读 `remoteAccess.decide(...)`（真实实现默认 deny），这里用全放行替身。
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
      // 存储：hub 与 domain 在前、后端紧随；会话持久化在工作区之前（工作区 init 里读它）。
      ...provideStorage(),
      ...provideStorageJson(configure(StorageJsonDefault, { root: join(root, "storages") })),
      SessionPersistenceDefault,
      // 三份 root（store / 投影 / 查询）由 `provideSessionRemote()` 自带（含 `provideSessionQuerySqlite()`），
      // 不能再并列一份——同名服务注册两次会直接抛。
      ...provideSessionRemote(),
      FakeAppEnv,
      SubprocessDefault,
      SandboxDefault,
      { provide: SandboxPolicyDefault, config: { mode: "workspace-write", workspaceRoot: root } },
      FsSandbox,
      // agent 域要在工作区/技能/working-directory 之前（它们 init 里读 `ctx.systemPrompt` / `ctx.tools`）。
      ...provideAgent(),
      // 循环期：要真 agent 工厂。

      ToolExecutorNative,

      { provide: AgentLoopDefault, config: { agents: [] } },
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      ...provideWorkspace(),
      ...provideSkill(),
      // 会话引用的宿主面与端点：都要上面那些的面。
      ...provideSessionReference(),
      ...provideApiSession(),
      Startup0,
      WebServerDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { app, handlers: gatewayHandlers(app), root };
}

/** 建一个真会话（`session/create` 起 agent 并落持久化）。 */
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

async function createSession(handlers: RemoteHandlers, cwd?: string): Promise<string> {
  const created = (await handlers.invoke("session/create", {
    request: cwd === undefined ? {} : { cwd },
  })) as { sessionId?: string };
  const sessionId = created.sessionId ?? "";
  expect(sessionId, `先要有一个真会话：${JSON.stringify(created)}`).not.toBe("");
  return sessionId;
}

describe("@ 引用的候选端点", { timeout: 30_000 }, () => {
  it("`fileReferences/list`：真实文件路径返回非空候选（不是没有实现，也不是空数组）", async () => {
    const { handlers, root } = await boot();
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "hello-reference.md"), "# hello\n", "utf8");
    const sessionId = await createSession(handlers, root);

    // wire 上的参数名是 `agentId`（descriptor 的 `wire`），gateway 会按名字取、再经 lookup 解析成 Agent。
    const result = await handlers.invoke("fileReferences/list", {
      agentId: sessionId,
      query: "hello",
    });
    // 上游 `@Remote` 方法返回**裸值**（不是自研端点的 `{ ok, value }` 包装）。
    const candidates = unwrap<readonly { path?: string }[]>(result) ?? [];
    expect(candidates.map((candidate) => candidate.path)).toContain("docs/hello-reference.md");

    // 空查询：上游实现（`LocalFileReferenceService` → `WorkspaceFileSearch.list("")`）**不列目录**，
    // 只按查询词搜。这里只断言"能调通、返回数组"，不假设它会给出目录 drill 行——
    // 那是我们自研端点当年的行为，不是上游的语义（UI 侧的 `@` 裸查询展示要另找依据）。
    const bare = await handlers.invoke("fileReferences/list", { agentId: sessionId, query: "" });
    expect(Array.isArray(unwrap<readonly unknown[]>(bare)), "空查询也必须返回数组").toBe(true);
  });

  it("恢复盘上会话：header 与盘上一致、`listSessions` 不冲突、`prompt` 被接受、文件候选非空", async () => {
    // 第一次启动：建会话并落盘（这一步的 agent 是 live 的）。
    const first = await boot();
    const sessionId = await createSession(first.handlers, first.root);
    // 盘上那一份 header：走契约读（`stat`），不读具体文件名——落盘布局归上游实现。
    // **刷一次再退出**：上游 `create` 只拿写句柄，真正写文件在 checkpoint / `flush` / `close`。
    await first.app.get(SessionPersistence).flush();
    const storedSnapshot = await first.app.get(SessionPersistence).stat(SessionId(sessionId));
    const storedHeader = storedSnapshot?.header as { id: string; cwd?: string; version: number };
    await first.app.dispose();

    // 第二次启动（同一个 dataDir）：live store 空、盘上有。`session/create {sessionId}` 走恢复分支。
    const second = await boot(first.root);
    // 恢复已有会话**必须带它自己的 cwd**：上游按 header.cwd 校验归属，缺省会用 `process.cwd()`，
    // 与盘上那份不一致就报 `session/conflict`。
    const restored = (await second.handlers.invoke("session/create", {
      request: { sessionId, cwd: first.root },
    })) as { sessionId?: string };
    expect(restored.sessionId, `恢复分支必须认回盘上的身份：${JSON.stringify(restored)}`).toBe(
      sessionId,
    );

    // 1) live header 必须就是盘上那一份：手工 prepare 新 header 是 `SESSION_QUERY_SOURCE_CONFLICT` 的来源。
    const live = second.app.get(SessionStore).get(SessionId(sessionId));
    expect(live, "恢复分支必须把会话放进 live store").toBeDefined();
    // 比**关键字段**而不是整个对象：`stat` 的快照由上游从日志首行重建，可能带上 `formatStatus`
    // 这类展示字段，而 live header 是创建时那一份。判据是"同一份身份与目录"。
    expect(live?.header).toMatchObject({
      id: storedHeader.id,
      cwd: storedHeader.cwd,
      version: storedHeader.version,
    });

    // 2) 目录列表不能因 live/盘上 header 不一致而抛 `SESSION_QUERY_SOURCE_CONFLICT`。
    const records = await second.app.get(SessionQuery).listSessions();
    expect(records.map((record) => record.header.id)).toContain(sessionId);

    // 3) 恢复后 agent 在场：`prompt` 不再被 resume 的 already-exists 挡住。
    const prompt = await second.handlers.invoke("session/prompt", {
      request: {
        requestId: "r-restore",
        sessionId,
        mode: "queue",
        content: [{ type: "text", text: "你好" }],
      },
    });
    expect(errorCodeOf(prompt), "恢复后的会话必须能 prompt").toBeUndefined();
    expect(unwrap<{ accepted?: boolean }>(prompt)).toEqual({ accepted: true });

    // 4) `@` 的文件候选同样依赖 `agents.get`：恢复会话也要回非空。
    const files = await second.handlers.invoke("fileReferences/list", {
      agentId: sessionId,
      query: "",
    });
    expect((unwrap<readonly unknown[]>(files) ?? []).length).toBeGreaterThan(0);
  });

  it("`session/page`（历史窗口）由上游提供：真实会话读得回一页", async () => {
    const { handlers } = await boot();
    const sessionId = await createSession(handlers);
    // 上游 `SessionController.page(request)`：descriptor 的 wire 是 `{ request }`。
    // 上游 `SessionPageRequest` 用 **durable address**（`{ kind: 'session', sessionId }`），
    // 不是裸 `sessionId`——传错形状会在 history controller 里读 `address.kind` 时崩。
    const page =
      unwrap<{ records?: readonly unknown[]; hasMore?: boolean }>(
        await handlers.invoke("session/page", {
          request: { address: { kind: "session", sessionId } },
        }),
      ) ?? {};
    // 新会话没有事件，但**端点必须是活的**——返回确定的空页，而不是"没有实现"。
    expect(Array.isArray(page.records), "`session/page` 必须回 records 数组").toBe(true);
    expect(page.records).toEqual([]);
  });

  it("`sessionReferenceResolver/candidates`：另一会话成为带 mention 的候选", async () => {
    const { handlers } = await boot();
    const first = await createSession(handlers);
    const second = await createSession(handlers);
    // 上游只把**可识别**的会话列为候选（无标题的空会话被过滤），所以先起个标题。
    await handlers.invoke("session/rename", {
      request: { sessionId: second, title: "被引用的会话" },
    });

    const result = await handlers.invoke("sessionReferenceResolver/candidates", {
      agentId: first,
      query: "",
    });
    // 上游 `@Remote` 方法返回**裸值**（不是自研端点的 `{ ok, value }` 包装）。
    const candidates = unwrap<readonly { sessionId?: string; mention?: string }[]>(result) ?? [];
    expect(candidates.map((candidate) => candidate.sessionId)).toContain(second);
    expect(candidates.find((candidate) => candidate.sessionId === second)?.mention).toContain(
      "dsh-session:",
    );
  });
});
