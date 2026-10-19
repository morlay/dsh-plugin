/**
 * `@` 引用的两条候选端点（`fileReferences/list` 与 `sessionReferenceResolver/candidates`）：
 * 真模块栈 + 真 `RemoteHandlers.invoke`，不手写端点替身。
 *
 * 判据是「候选非空且指向真实路径」——静默返回空数组不算接上：
 * 输入框里的 `@` 菜单拿空列表和拿「没有实现」在用户眼里都是「没生效」。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent, provideSessionReference } from "@morlay/dsh-agent/server";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSkill } from "@morlay/dsh-skill/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { provideUpload } from "@morlay/dsh-upload/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-working-directory";
import { SessionWorkspaceHost } from "@morlay/dsh-workspace";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import {
  provideApiGateway,
  provideConnection,
  provideRemoteAccess,
  RemoteHandlersDefault,
  provideTypert,
} from "@morlay/zephyr-app";
import { WebServerDefault, WebStartup } from "@morlay/zephyr-app/testing";
import { afterEach, describe, expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { SessionQuery } from "../contract/session-query.contract.ts";
import { SessionStore } from "../contract/session.contract.ts";
import { provideSessionQuerySqlite } from "../server/session-query.provide.ts";
import { provideSessionRemote } from "../server/session-remote.provide.ts";
import { provideSessionsHost } from "../server/sessions-host.provide.ts";
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
    readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false, aggregate: [] };

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
      ...provideSkill(),
      ...provideSessionRemote(),
      ...provideSessionsHost(),
      ...provideSessionReference(),
    
      FakeAppEnv,
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

/** 建一个真会话（`session/create` 起 agent 并落持久化）。 */
async function createSession(handlers: RemoteHandlers, cwd?: string): Promise<string> {
  const created = (await handlers.invoke("session/create", {
    request: cwd === undefined ? {} : { cwd },
  })) as { sessionId?: string };
  const sessionId = created.sessionId ?? "";
  expect(sessionId, "先要有一个真会话").not.toBe("");
  return sessionId;
}

describe("@ 引用的候选端点", { timeout: 30_000 }, () => {
  it("`fileReferences/list`：真实文件路径返回非空候选（不是没有实现，也不是空数组）", async () => {
    const { handlers, root } = await boot();
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "hello-reference.md"), "# hello\n", "utf8");
    const sessionId = await createSession(handlers, root);

    const result = await handlers.invoke("fileReferences/list", {
      agent: sessionId,
      query: "hello",
    });
    expect(result, "端点必须有实现（返回 RemoteResult，而不是抛 '没有实现'）").toMatchObject({
      ok: true,
    });
    const candidates = (result as { value?: readonly { path?: string }[] }).value ?? [];
    expect(candidates.map((candidate) => candidate.path)).toContain("docs/hello-reference.md");

    // 用户刚敲下 `@`（裸查询）时列的是 cwd 根：目录也要作为候选（`ui-reference` 的 drill 行）。
    const bare = await handlers.invoke("fileReferences/list", { agent: sessionId, query: "" });
    const barePaths = ((bare as { value?: readonly { path?: string }[] }).value ?? []).map(
      (candidate) => candidate.path,
    );
    expect(barePaths).toContain("docs");
  });

  it("恢复盘上会话：header 与盘上一致、`listSessions` 不冲突、`prompt` 被接受、文件候选非空", async () => {
    // 第一次启动：建会话并落盘（这一步的 agent 是 live 的）。
    const first = await boot();
    const sessionId = await createSession(first.handlers, first.root);
    const metaPath = join(first.root, "sessions", encodeURIComponent(sessionId), "meta.json");
    const storedHeader = (JSON.parse(await readFile(metaPath, "utf8")) as { header: unknown })
      .header;
    await first.app.dispose();

    // 第二次启动（同一个 dataDir）：live store 空、盘上有。`session/create {sessionId}` 走恢复分支。
    const second = await boot(first.root);
    const restored = (await second.handlers.invoke("session/create", {
      request: { sessionId },
    })) as { sessionId?: string };
    expect(restored.sessionId, "恢复分支必须认回盘上的身份").toBe(sessionId);

    // 1) live header 必须就是盘上那一份：手工 prepare 新 header 是 `SESSION_QUERY_SOURCE_CONFLICT` 的来源。
    const live = second.app.get(SessionStore).get(SessionId(sessionId));
    expect(live, "恢复分支必须把会话放进 live store").toBeDefined();
    expect(live?.header).toEqual(storedHeader);

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
      agent: sessionId,
      query: "",
    });
    expect((unwrap<readonly unknown[]>(files) ?? []).length).toBeGreaterThan(0);
  });

  it("`sessionReferenceResolver/candidates`：另一会话成为带 mention 的候选", async () => {
    const { handlers } = await boot();
    const first = await createSession(handlers);
    const second = await createSession(handlers);

    const result = await handlers.invoke("sessionReferenceResolver/candidates", {
      agent: first,
      query: "",
    });
    expect(result, "端点必须有实现（返回 RemoteResult，而不是抛 '没有实现'）").toMatchObject({
      ok: true,
    });
    const candidates =
      (result as { value?: readonly { sessionId?: string; mention?: string }[] }).value ?? [];
    expect(candidates.map((candidate) => candidate.sessionId)).toContain(second);
    expect(candidates.find((candidate) => candidate.sessionId === second)?.mention).toContain(
      "dsh-session:",
    );
  });
});
